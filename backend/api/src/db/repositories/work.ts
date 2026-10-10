import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { NotFoundError, UserError } from '../../core/errors.js';
import {
  calculatePriceSummary,
  toPricingLine,
  type PriceSummary,
} from '../../core/pricing.js';
import { likePattern, PageQuery, wildcardTokens } from '../../core/paging.js';
import { estimateNumber, withSequence } from '../../core/sequences.js';

/**
 * Port of `WorkController` and the `Work` aggregate.
 *
 * A work order owns offers (estimates) and repair jobs. Both hold line items
 * stored through the `saleable` super-table with `productoffered` /
 * `productinstalled` as subtype tables, so a product line spans two inserts.
 *
 * `Product.Synchronize` compared entities with `GuidIdentityEntity.operator ==`,
 * which compares ids for persistent entities and reference-identity for two
 * transient ones. A line posted with the nil uuid is therefore transient and
 * never matches an existing row, so it is inserted; a line posted with a real id
 * is updated in place; and any stored row missing from the request is removed.
 */

/** `Guid.Empty` — a transient entity, i.e. "insert this line". */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** `WorkStatus`. `Enum.Parse` in the original was case-sensitive. */
export const WORK_STATUSES = ['Default', 'InProgress', 'Closed'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** `PaymentType`. */
export const PAYMENT_TYPES = { Cash: 1, BankTransfer: 2, Card: 3 } as const;

export interface SaleableLine {
  id: string | null;
  code: string | null;
  name: string | null;
  kind: 'product' | 'service';
  quantity: number | null;
  unit: string | null;
  price: number | null;
  discount: number | null;
}

export interface Activity {
  id: string;
  number: string;
  startedOn: string | null;
  startedBy: string | null;
  name: 'offer' | 'repairjob';
  notes: string | null;
  isVehicleLinesOnPricing: boolean;
  isEmpty: boolean;
}

export interface WorkIssuance {
  sentOn: string | null;
  issuedOn: string | null;
  issuedBy: string | null;
  receiverEmail: string | null;
  invoiceNumber: number;
  dueDays: number;
  isPaid: boolean;
}

export interface WorkDetail {
  id: string;
  number: string;
  startedOn: string | null;
  startedBy: string | null;
  name: 'work';
  isEmpty: boolean;
  clientId: string | null;
  clientName: string | null;
  clientAddress: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  vehicleId: string | null;
  vehicleProducer: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleRegNr: string | null;
  notes: string | null;
  odo: number | null;
  mechanics: { id: string; name: string | null }[];
  status: string;
  issuance: WorkIssuance | null;
}

export interface ActivitiesResult {
  items: Activity[];
  current: {
    id: string;
    notes: string | null;
    isVehicleLinesOnPricing: boolean;
    products: SaleableLine[];
    priceSummary: PriceSummary;
  };
}

export interface OfferIssuance {
  id: string;
  number: string | null;
  sentOn: string | null;
  issuedOn: string | null;
  receiverEmail: string | null;
  issuedBy: string | null;
  acceptedOn: string | null;
  acceptedBy: string | null;
}

/** `WorkPage` as bound by Dapper; `sentOn` and `issued` are never projected. */
export interface WorkPageItem {
  id: string;
  workNr: string | null;
  startedOn: string | null;
  sentOn: string | null;
  status: string;
  issued: string | null;
  clientId: string | null;
  clientName: string | null;
  vehicleId: string | null;
  regNr: string | null;
  mechanicNames: string | null;
  notes: string | null;
  hasRepairs: boolean;
  numberOfOffers: number;
  offerIssuance: OfferIssuance | null;
  issuance: WorkIssuance | null;
}

export interface WorkPageRequest {
  searchText?: string | undefined;
  limit: number;
  offset: number;
  status?: string | undefined;
  issued?: string | undefined;
  saleable?: string | undefined;
  workFrom?: string | undefined;
  workTo?: string | undefined;
  invoiceFrom?: string | undefined;
  invoiceTo?: string | undefined;
  clientId?: string | undefined;
  vehicleId?: string | undefined;
}

type Kind = 'offer' | 'repairjob';
/** A line is either a catalogue product or a service/labour line. */
type LineKind = 'product' | 'service';

/** Table and owning-column pairs for the two activity kinds. */
const PRODUCT_TABLE: Record<Kind, string> = {
  offer: 'domain.productoffered',
  repairjob: 'domain.productinstalled',
};
/** Subtype table for a service line, sharing the owner columns below. */
const SERVICE_TABLE: Record<Kind, string> = {
  offer: 'domain.serviceoffered',
  repairjob: 'domain.serviceperformed',
};
const OWNER_COLUMN: Record<Kind, string> = {
  offer: 'offerid',
  repairjob: 'repairjobid',
};
const OWNER_TABLE: Record<Kind, string> = {
  offer: 'domain.offer',
  repairjob: 'domain.repairjob',
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** `AddressComponent.ToString` joins the non-blank parts with ", ". */
const CLIENT_ADDRESS_SQL = sql`
  concat_ws(', ',
    nullif(btrim(coalesce(c.country, '')), ''),
    nullif(btrim(coalesce(c.region, '')), ''),
    nullif(btrim(coalesce(c.city, '')), ''),
    nullif(btrim(coalesce(c.address, '')), ''),
    nullif(btrim(coalesce(c.postalcode, '')), ''))
`;

export class WorkRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /* ── Reads ──────────────────────────────────────────────────────────────── */

  /** `WorkController.Get(Guid)`. */
  async find(id: string): Promise<WorkDetail | undefined> {
    const result = await sql<WorkDetailRow>`
      SELECT
        w.id,
        w.number,
        w.startedon,
        concat_ws(' ', st.firstname, st.lastname) as startedby,
        concat_ws(' ', pc.firstname, pc.lastname, lc.name) as clientname,
        ${CLIENT_ADDRESS_SQL} as clientaddress,
        c.phone as clientphone,
        ce.address as clientemail,
        w.clientid,
        w.vehicleid,
        v.producer as vehicleproducer,
        v.model as vehiclemodel,
        v.vin as vehiclevin,
        v.regnr as vehicleregnr,
        w.notes,
        w.odo,
        case when w.invoiceid is not null then 'completed' else lower(w.userstatus) end as status,
        i.number as invoicenumber,
        i.duedays,
        i.ispaid,
        ip.senton,
        ip.issuedon,
        concat_ws(' ', ii.firstname, ii.lastname) as invoiceissuedby,
        ip.email as invoiceemail,
        exists (
          select 1 from domain.productoffered po
            inner join domain.offer o on o.id = po.offerid
           where o.workid = w.id
        ) or exists (
          select 1 from domain.serviceoffered so
            inner join domain.offer o on o.id = so.offerid
           where o.workid = w.id
        ) as offerhasproducts,
        exists (
          select 1 from domain.productinstalled pi
            inner join domain.repairjob rj on rj.id = pi.repairjobid
           where rj.workid = w.id
        ) or exists (
          select 1 from domain.serviceperformed sp
            inner join domain.repairjob rj on rj.id = sp.repairjobid
           where rj.workid = w.id
        ) as jobhasproducts
      FROM domain.work w
        LEFT JOIN domain.employee st ON st.id = w.starterid
        LEFT JOIN domain.privateclient pc ON pc.id = w.clientid
        LEFT JOIN domain.legalclient lc ON lc.id = w.clientid
        LEFT JOIN domain.client c ON c.id = w.clientid
        LEFT JOIN domain.clientemail ce ON ce.clientid = w.clientid AND ce.isactive
        LEFT JOIN domain.vehicle v ON v.id = w.vehicleid
        LEFT JOIN domain.invoice i ON i.id = w.invoiceid
        LEFT JOIN domain.pricing ip ON ip.id = i.id
        LEFT JOIN domain.employee ii ON ii.id = ip.issuerid
      WHERE w.id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;

    const mechanics = await sql<{ id: string; name: string | null }>`
      select e.id, concat_ws(' ', e.firstname, e.lastname) as name
        from domain.assignment a
        inner join domain.employee e on e.id = a.mechanicid
       where a.workid = ${id}::uuid
       order by name
    `.execute(this.db);

    return {
      id: row.id,
      number: String(row.number),
      startedOn: iso(row.startedon),
      startedBy: row.startedby,
      name: 'work',
      // `IsEmpty` ignored services and only asked whether any activity had lines.
      isEmpty: !(row.offerhasproducts || row.jobhasproducts),
      clientId: row.clientid,
      clientName: row.clientname,
      clientAddress: row.clientaddress,
      clientEmail: row.clientemail,
      clientPhone: row.clientphone,
      vehicleId: row.vehicleid,
      vehicleProducer: row.vehicleproducer,
      vehicleModel: row.vehiclemodel,
      vehicleVin: row.vehiclevin,
      vehicleRegNr: row.vehicleregnr,
      notes: row.notes,
      odo: row.odo === null || row.odo === undefined ? null : Number(row.odo),
      mechanics: mechanics.rows.map((m) => ({ id: m.id, name: m.name })),
      status: row.status,
      issuance:
        row.invoicenumber == null
          ? null
          : {
              sentOn: iso(row.senton),
              issuedOn: iso(row.issuedon),
              issuedBy: row.invoiceissuedby,
              receiverEmail: row.invoiceemail,
              invoiceNumber: Number(row.invoicenumber),
              dueDays: Number(row.duedays ?? 0),
              isPaid: Boolean(row.ispaid),
            },
    };
  }

  async findOrFail(id: string): Promise<WorkDetail> {
    const work = await this.find(id);
    if (!work) throw new NotFoundError('Work');
    return work;
  }

  /**
   * `WorkController.Activities`. An empty object is returned when the work order
   * has no activities at all, as the original did.
   */
  async activities(workId: string, currentId: string | undefined, vatRate: number): Promise<ActivitiesResult | Record<string, never>> {
    const result = await sql<ActivityRow>`
      select a.id,
             a.ordernr::text as number,
             a.startedon,
             a.name,
             concat_ws(' ', e.firstname, e.lastname) as startedby,
             a.notes,
             a.isvehiclelinesonpricing,
             a.isempty
      from (
        select
          o.id, o.ordernr, o.startedon, o.starterid, 'offer'::text as name, o.notes,
          o.isvehilelinesonestimate as isvehiclelinesonpricing,
          ((o.notes is null or length(o.notes) = 0)
             and not exists (select 1 from domain.productoffered where offerid = o.id)
             and not exists (select 1 from domain.serviceoffered where offerid = o.id)) as isempty
        from domain.offer o where o.workid = ${workId}::uuid
        union all
        select
          rj.id, rj.ordernr, rj.startedon, rj.starterid, 'repairjob'::text as name, rj.notes,
          true as isvehiclelinesonpricing,
          ((rj.notes is null or length(rj.notes) = 0)
             and not exists (select 1 from domain.productinstalled where repairjobid = rj.id)
             and not exists (select 1 from domain.serviceperformed where repairjobid = rj.id)) as isempty
        from domain.repairjob rj where rj.workid = ${workId}::uuid
      ) a
      inner join domain.employee e on e.id = a.starterid
      order by a.startedon desc
    `.execute(this.db);

    if (result.rows.length === 0) return {};

    const items: Activity[] = result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      startedOn: iso(row.startedon),
      startedBy: row.startedby,
      name: row.name,
      notes: row.notes,
      isVehicleLinesOnPricing: row.isvehiclelinesonpricing,
      isEmpty: row.isempty,
    }));

    const current =
      currentId && currentId !== NIL_UUID
        ? items.find((a) => a.id === currentId)
        : items[0];

    // `Single` threw when the requested id was not one of the activities.
    if (!current) throw new NotFoundError('Activity');

    const products = await this.linesOf(
      current.name === 'repairjob' ? 'repairjob' : 'offer',
      current.id,
    );

    return {
      items,
      current: {
        id: current.id,
        notes: current.notes,
        isVehicleLinesOnPricing: current.isVehicleLinesOnPricing,
        products,
        priceSummary: calculatePriceSummary(vatRate, products),
      },
    };
  }

  /** `WorkController.GetPage`. */
  async page(input: WorkPageRequest): Promise<{ hasMore: boolean; items: WorkPageItem[] }> {
    const onlyIssued = input.issued === 'on';

    const query = new PageQuery(
      {
        searchText: input.searchText,
        // The original replaced any caller-supplied ordering with these two.
        orderby: onlyIssued ? 'i.number' : 'w.changedon',
        limit: input.limit,
        offset: input.offset,
        // And forced descending order regardless of the query string.
        desc: true,
      },
      { allowedOrderBy: ['i.number', 'w.changedon'], defaultOrderBy: 'w.changedon' },
    ).searchFields(
      `concat_ws(' ', w.number::text, p.firstname, p.lastname, l.name, v.regnr, v.vin,
        array_to_string((select array_agg(e.number) from domain.offer o
          inner join domain.estimate e on e.id = o.estimateid
          where workid = w.id), '/ '),
        (select number from domain.invoice where id = w.invoiceid))`,
    );

    if (!onlyIssued) {
      query.where(sql`w.invoiceid is null`);
    }

    switch (input.status) {
      case 'inprogress':
        query.where(sql`w.userstatus = 'InProgress'`);
        break;
      case 'closed':
        query.where(sql`w.userstatus = 'Closed'`);
        break;
      case 'overdue':
        // The original read `i.ispaid`/`ip.issuedon` directly, but only joined
        // those tables in the issued view, so the combination was a SQL error.
        // A correlated subquery gives the same answer in both views: in the work
        // view `w.invoiceid is null` already excludes it, so nothing matches.
        query.where(sql`
          exists (
            select 1
              from domain.invoice i
              inner join domain.pricing ip on ip.id = i.id
             where i.id = w.invoiceid
               and i.ispaid = false
               and (ip.issuedon + i.duedays * interval '1 day' <= current_timestamp)
          )
        `);
        break;
      default:
        break;
    }

    if (input.clientId) query.where(sql`w.clientid = ${input.clientId}::uuid`);
    if (input.vehicleId) query.where(sql`w.vehicleid = ${input.vehicleId}::uuid`);

    // Deliberate deviation from the original, which guarded its work-date filter
    // with `if (workForm is not null || workForm is not null)`. No such query
    // parameter exists — the UI sends `workFrom` — so that branch was dead code
    // and both work dates were silently ignored. Each filter now uses its own
    // dates and column, which is what the parameter names imply. The invoice
    // dates go through a subquery so they also work outside the issued view,
    // where `ip` is not joined.
    query.dateRange('w.startedon', input.workFrom, input.workTo);
    query.dateRange(
      sql`
        (select ip.issuedon
           from domain.pricing ip
           inner join domain.invoice i2 on i2.id = ip.id
          where i2.id = w.invoiceid)
      `,
      input.invoiceFrom,
      input.invoiceTo,
    );

    if (input.saleable && input.saleable.trim() !== '') {
      const tokens = wildcardTokens(input.saleable);
      const productRestriction = sql.join(
        tokens.map(
          (token) => sql`concat_ws(' ', p.code, s.name) ilike ${likePattern(token)}`,
        ),
        sql` and `,
      );
      // Service subtypes have no `code` column, so only the name is searched.
      const serviceRestriction = sql.join(
        tokens.map((token) => sql`concat_ws(' ', s.name) ilike ${likePattern(token)}`),
        sql` and `,
      );

      query.where(
        onlyIssued
          ? sql`
              exists (
                select 1 from domain.productinstalled p
                  inner join domain.saleable s on s.id = p.id
                  inner join domain.repairjob rj on rj.id = p.repairjobid
                 where rj.workid = w.id and ${productRestriction}
              ) or exists (
                select 1 from domain.serviceperformed p
                  inner join domain.saleable s on s.id = p.id
                  inner join domain.repairjob rj on rj.id = p.repairjobid
                 where rj.workid = w.id and ${serviceRestriction}
              )
            `
          : sql`
              exists (
                select 1 from domain.productoffered p
                  inner join domain.saleable s on s.id = p.id
                  inner join domain.offer offer on offer.id = p.offerid
                 where offer.workid = w.id and ${productRestriction}
              ) or exists (
                select 1 from domain.serviceoffered p
                  inner join domain.saleable s on s.id = p.id
                  inner join domain.offer offer on offer.id = p.offerid
                 where offer.workid = w.id and ${serviceRestriction}
              )
            `,
      );
    }

    const { where, orderBy } = query.expose();

    const issuanceSql = sql`
      json_build_object(
        'invoiceNumber', i.number,
        'isPaid', i.ispaid,
        'dueDays', i.duedays,
        'issuedOn', ip.issuedon,
        'issuedBy', concat_ws(' ', ii.firstname, ii.lastname),
        'sentOn', ip.senton,
        'receiverEmail', ip.email
      ) as issuance
    `;

    const numberOfOffersSql = sql`
      (select count(*) from domain.offer o where o.workid = w.id) as numberofoffers
    `;

    const hasRepairsSql = sql`
      exists (select 1 from domain.repairjob r where r.workid = w.id) as hasrepairs
    `;

    const mechanicNamesSql = sql`
      (select string_agg(concat_ws(' ', m.firstname, m.lastname), '/ ')
         from domain.assignment a
         inner join domain.employee m on a.mechanicid = m.id and a.workid = w.id
      ) as mechanicnames
    `;

    // Only offered when the work order has exactly one estimate, and it has to
    // reference the wrapper alias, so it belongs to the outer select.
    const offerIssuanceSql = sql`
      (select json_build_object(
         'id', o.id,
         'number', e.number,
         'acceptedOn', o.acceptedon,
         'acceptedBy', concat_ws(' ', acp.firstname, acp.lastname),
         'sentOn', p.senton,
         'issuedOn', p.issuedon,
         'issuedBy', concat_ws(' ', emp.firstname, emp.lastname),
         'receiverEmail', p.email
       )
         from domain.offer o
           inner join domain.pricing p on p.id = o.estimateid
           inner join domain.estimate e on e.id = o.estimateid
           inner join domain.employee emp on emp.id = p.issuerid
           left join domain.employee acp on acp.id = o.acceptorid
        where page.numberofoffers = 1 and o.workid = page.id
      ) as offerissuance
    `;

    const extraJoins = onlyIssued
      ? sql`
          inner join domain.invoice i on i.id = w.invoiceid
          inner join domain.pricing ip on ip.id = i.id
          inner join domain.employee ii on ii.id = ip.issuerid
        `
      : sql``;

    const result = await sql<WorkPageRow>`
      select page.*,
             case when page.invoiceid is not null then 'completed' else lower(page.userstatus) end as status
             ${onlyIssued ? sql.raw('') : sql`, ${offerIssuanceSql}`}
      from (
        select
          w.invoiceid,
          w.id,
          w.userstatus,
          w.number as worknr,
          w.startedon,
          ${onlyIssued ? issuanceSql : numberOfOffersSql},
          ${onlyIssued ? sql.raw('') : hasRepairsSql},
          w.clientid,
          concat_ws(' ', p.firstname, p.lastname, l.name) as clientname,
          w.vehicleid,
          v.regnr,
          ${mechanicNamesSql},
          w.notes
        from domain.work w
          ${extraJoins}
          left join domain.legalclient l on l.id = w.clientid
          left join domain.privateclient p on p.id = w.clientid
          left join domain.vehicle v on v.id = w.vehicleid
          ${where ?? sql.raw('')}
          ${orderBy}
          limit ${input.limit + 1} offset ${input.offset}
      ) page
    `.execute(this.db);

    const rows = result.rows;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;

    return {
      hasMore,
      items: page.map((row) => ({
        id: row.id,
        workNr: row.worknr == null ? null : String(row.worknr),
        startedOn: iso(row.startedon),
        sentOn: null,
        status: row.status,
        issued: null,
        clientId: row.clientid,
        clientName: row.clientname,
        vehicleId: row.vehicleid,
        regNr: row.regnr,
        mechanicNames: row.mechanicnames,
        notes: row.notes,
        hasRepairs: Boolean(row.hasrepairs),
        numberOfOffers: Number(row.numberofoffers ?? 0),
        offerIssuance: row.offerissuance ?? null,
        issuance: row.issuance ?? null,
      })),
    };
  }

  /** Line items of an offer or a repair job, ordered by line number. */
  async linesOf(kind: Kind, ownerId: string): Promise<SaleableLine[]> {
    const result = await sql<SaleableRow>`
      select 'product'::text as kind, p.id, p.code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
        from ${sql.raw(PRODUCT_TABLE[kind])} p
        inner join domain.saleable s on s.id = p.id
       where p.${sql.raw(OWNER_COLUMN[kind])} = ${ownerId}::uuid
      union all
      select 'service'::text as kind, p.id, null as code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
        from ${sql.raw(SERVICE_TABLE[kind])} p
        inner join domain.saleable s on s.id = p.id
       where p.${sql.raw(OWNER_COLUMN[kind])} = ${ownerId}::uuid
       order by jnr, kind
    `.execute(this.db);

    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind === 'service' ? 'service' : 'product',
      quantity: row.quantity,
      unit: row.unit,
      price: row.price,
      discount: row.discount,
    }));
  }

  /* ── Work order lifecycle ──────────────────────────────────────────────── */

  /**
   * `WorkController.Post`.
   *
   * The description was only stored on the work order when *not* starting with an
   * offer, because `CreateOffer` consumed the same value as the activity notes.
   */
  async create(input: {
    clientId?: string | null | undefined;
    vehicleId?: string | null | undefined;
    description?: string | null | undefined;
    assignedTo?: readonly string[] | null | undefined;
    odo?: number | null | undefined;
    startWithOffer?: boolean | undefined;
    starterId: string;
  }): Promise<{ workId: string; activityId: string }> {
    const workId = randomUUID();
    const activityId = randomUUID();
    const startWithOffer = input.startWithOffer ?? false;

    await withSequence(this.db, 'work', async (number, tx) => {
      await sql`
        INSERT INTO domain.work
          (id, number, clientid, vehicleid, startedon, changedon, starterid, notes, odo, userstatus)
        VALUES (
          ${workId}::uuid,
          ${number},
          ${input.clientId ?? null}::uuid,
          ${input.vehicleId ?? null}::uuid,
          now(),
          now(),
          ${input.starterId}::uuid,
          ${startWithOffer ? null : (input.description ?? null)},
          ${input.odo ?? null},
          'Default'
        )
      `.execute(tx);

      await this.replaceAssignments(tx, workId, input.assignedTo ?? []);

      if (startWithOffer) {
        await sql`
          INSERT INTO domain.offer (id, workid, ordernr, notes, estimateid, isvehilelinesonestimate, startedon, starterid)
          VALUES (${activityId}::uuid, ${workId}::uuid, 0, ${input.description ?? null}, null, false, now(), ${input.starterId}::uuid)
        `.execute(tx);
      } else {
        await sql`
          INSERT INTO domain.repairjob (id, workid, ordernr, notes, startedon, starterid)
          VALUES (${activityId}::uuid, ${workId}::uuid, 0, ${input.description ?? null}, now(), ${input.starterId}::uuid)
        `.execute(tx);
      }
    });

    return { workId, activityId };
  }

  /** `WorkController.Put`. */
  async update(
    id: string,
    input: {
      clientId?: string | null | undefined;
      vehicleId?: string | null | undefined;
      description?: string | null | undefined;
      assignedTo?: readonly string[] | null | undefined;
    },
  ): Promise<string> {
    await this.findOrFail(id);

    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE domain.work SET
          clientid = ${input.clientId ?? null}::uuid,
          vehicleid = ${input.vehicleId ?? null}::uuid,
          notes = ${input.description ?? null},
          changedon = now()
        WHERE id = ${id}::uuid
      `.execute(tx);

      await this.replaceAssignments(tx, id, input.assignedTo ?? []);
    });

    return id;
  }

  /**
   * `WorkController.Delete`. The two guards reported different messages, so they
   * are kept apart rather than merged.
   */
  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const result = await sql<{ sentoffer: boolean; sentinvoice: boolean }>`
        SELECT
          exists (
            select 1 from domain.offer o
              inner join domain.pricing p on p.id = o.estimateid
             where o.workid = ${id}::uuid and p.senton is not null
          ) as sentoffer,
          exists (
            select 1 from domain.invoice i
              inner join domain.pricing p on p.id = i.id
             where i.id = (select invoiceid from domain.work where id = ${id}::uuid)
               and p.senton is not null
          ) as sentinvoice
      `.execute(this.db);

      const row = result.rows[0];
      if (row?.sentoffer) {
        throw new UserError('Cannot delete work, it contains an offer sent to a client.');
      }
      if (row?.sentinvoice) {
        throw new UserError('Cannot delete work, it contains an invoice sent to a client.');
      }

      await this.db.transaction().execute(async (tx) => {
        await this.deleteWorkGraph(tx, id);
      });
    }
  }

  /** Removes a work order and everything hanging off it. */
  private async deleteWorkGraph(tx: Kysely<Database>, workId: string): Promise<void> {
    const offers = await sql<{ id: string }>`
      SELECT id FROM domain.offer WHERE workid = ${workId}::uuid
    `.execute(tx);
    for (const offer of offers.rows) {
      await this.deleteOfferGraph(tx, offer.id);
    }

    const jobs = await sql<{ id: string }>`
      SELECT id FROM domain.repairjob WHERE workid = ${workId}::uuid
    `.execute(tx);
    for (const job of jobs.rows) {
      await this.deleteRepairJobGraph(tx, job.id);
    }

    await sql`DELETE FROM domain.assignment WHERE workid = ${workId}::uuid`.execute(tx);

    // `work.invoiceid` is a nullable FK; the referencing row has to go first.
    await sql`UPDATE domain.work SET invoiceid = null WHERE id = ${workId}::uuid`.execute(tx);
    await sql`DELETE FROM domain.work WHERE id = ${workId}::uuid`.execute(tx);
  }

  private async deleteOfferGraph(tx: Kysely<Database>, offerId: string): Promise<void> {
    const estimate = await sql<{ estimateid: string | null }>`
      SELECT estimateid FROM domain.offer WHERE id = ${offerId}::uuid
    `.execute(tx);

    await this.deleteProductLines(tx, 'offer', offerId);
    await sql`DELETE FROM domain.offer WHERE id = ${offerId}::uuid`.execute(tx);

    const estimateId = estimate.rows[0]?.estimateid;
    if (estimateId) {
      await sql`DELETE FROM domain.pricingline WHERE pricingid = ${estimateId}::uuid`.execute(tx);
      // `domain.estimate.id` references `domain.pricing`, so subtype first.
      await sql`DELETE FROM domain.estimate WHERE id = ${estimateId}::uuid`.execute(tx);
      await sql`DELETE FROM domain.pricing WHERE id = ${estimateId}::uuid`.execute(tx);
    }
  }

  private async deleteRepairJobGraph(tx: Kysely<Database>, jobId: string): Promise<void> {
    await this.deleteProductLines(tx, 'repairjob', jobId);
    await sql`DELETE FROM domain.repairjob WHERE id = ${jobId}::uuid`.execute(tx);
  }

  /** Drops the subtype rows (product and service) and then their shared `saleable` rows. */
  private async deleteProductLines(
    tx: Kysely<Database>,
    kind: Kind,
    ownerId: string,
  ): Promise<void> {
    for (const table of [PRODUCT_TABLE[kind], SERVICE_TABLE[kind]]) {
      const ids = await sql<{ id: string }>`
        SELECT id FROM ${sql.raw(table)}
         WHERE ${sql.raw(OWNER_COLUMN[kind])} = ${ownerId}::uuid
      `.execute(tx);

      for (const { id } of ids.rows) {
        await sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.saleable WHERE id = ${id}::uuid`.execute(tx);
      }
    }
  }

  /* ── Activities ─────────────────────────────────────────────────────────── */

  /**
   * `WorkController.PutStatus`. `ChangeState` refuses to close an invoiced work
   * order, and the original deliberately left `changedon` alone when closing so
   * closed orders stop floating to the top of the list.
   */
  async setStatus(id: string, status: WorkStatus): Promise<void> {
    const work = await this.findOrFail(id);

    if (work.issuance && status === 'Closed') {
      throw new UserError('Cannot close, invoice issued.');
    }

    if (status === 'Closed') {
      await sql`
        UPDATE domain.work SET userstatus = ${status} WHERE id = ${id}::uuid
      `.execute(this.db);
      return;
    }

    await sql`
      UPDATE domain.work SET userstatus = ${status}, changedon = now() WHERE id = ${id}::uuid
    `.execute(this.db);
  }

  /** `WorkController.PutOffer`. */
  async updateOffer(
    workId: string,
    offerNumber: number,
    notes: string | null,
    showVehicleOnPricing: boolean,
  ): Promise<void> {
    const offerId = await this.findActivityId('offer', workId, offerNumber);
    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE domain.offer SET
          notes = ${notes},
          isvehilelinesonestimate = ${showVehicleOnPricing}
        WHERE id = ${offerId}::uuid
      `.execute(tx);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });
  }

  /**
   * `WorkController.PutRepairJob`. The vehicle-line flag was deliberately left
   * untouched here (`//todo?` in the original), so it is not updated.
   */
  async updateRepairJob(workId: string, jobNumber: number, notes: string | null): Promise<void> {
    const jobId = await this.findActivityId('repairjob', workId, jobNumber);
    await this.db.transaction().execute(async (tx) => {
      await sql`UPDATE domain.repairjob SET notes = ${notes} WHERE id = ${jobId}::uuid`.execute(tx);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });
  }

  /** Resolves `ordernr` to an activity id, mirroring `Single(x => x.OrderNr == n)`. */
  private async findActivityId(kind: Kind, workId: string, orderNr: number): Promise<string> {
    const table = kind === 'offer' ? 'domain.offer' : 'domain.repairjob';
    const result = await sql<{ id: string }>`
      SELECT id FROM ${sql.raw(table)}
       WHERE workid = ${workId}::uuid AND ordernr = ${orderNr}
    `.execute(this.db);

    const id = result.rows[0]?.id;
    if (!id) throw new NotFoundError(kind === 'offer' ? 'Offer' : 'Repair job');
    return id;
  }

  /** `Work.CreateOffer`. */
  async createOffer(workId: string, starterId: string, notes: string | null): Promise<string> {
    await this.findOrFail(workId);
    const id = randomUUID();

    await this.db.transaction().execute(async (tx) => {
      // `Offer`'s constructor numbered the new offer from the current maximum.
      const next = await sql<{ next: number | string }>`
        SELECT coalesce(max(ordernr), -1) + 1 as next FROM domain.offer WHERE workid = ${workId}::uuid
      `.execute(tx);

      await sql`
        INSERT INTO domain.offer (id, workid, ordernr, notes, estimateid, isvehilelinesonestimate, startedon, starterid)
        VALUES (${id}::uuid, ${workId}::uuid, ${Number(next.rows[0]?.next ?? 0)}, ${notes}, null, false, now(), ${starterId}::uuid)
      `.execute(tx);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });

    return id;
  }

  /** `Work.StartRepairJob`. */
  async createRepairJob(workId: string, starterId: string, notes: string | null): Promise<string> {
    await this.findOrFail(workId);
    const id = randomUUID();

    await this.db.transaction().execute(async (tx) => {
      const next = await sql<{ next: number | string }>`
        SELECT coalesce(max(ordernr), -1) + 1 as next FROM domain.repairjob WHERE workid = ${workId}::uuid
      `.execute(tx);

      await sql`
        INSERT INTO domain.repairjob (id, workid, ordernr, notes, startedon, starterid)
        VALUES (${id}::uuid, ${workId}::uuid, ${Number(next.rows[0]?.next ?? 0)}, ${notes}, now(), ${starterId}::uuid)
      `.execute(tx);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });

    return id;
  }

  /** `WorkController.DeleteOffer`. */
  async removeOffer(workId: string, offerNumber: number): Promise<void> {
    const offerId = await this.findActivityId('offer', workId, offerNumber);
    await this.db.transaction().execute(async (tx) => {
      await this.deleteOfferGraph(tx, offerId);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });
  }

  /** `WorkController.DeleteRepairJob`. */
  async removeRepairJob(workId: string, jobNumber: number): Promise<void> {
    const jobId = await this.findActivityId('repairjob', workId, jobNumber);
    await this.db.transaction().execute(async (tx) => {
      await this.deleteRepairJobGraph(tx, jobId);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });
  }

  /**
   * `Offer.Accepted` — marks the offer accepted and copies its lines onto a
   * repair job, creating one when `targetJobNumber` did not match an existing job.
   * Returns the job id.
   */
  async acceptOffer(
    workId: string,
    offerNumber: number,
    targetJobNumber: number | null | undefined,
    notes: string | null,
    acceptorId: string,
  ): Promise<string> {
    await this.findOrFail(workId);
    const offerId = await this.findActivityId('offer', workId, offerNumber);

    // `SingleOrDefault(x => x.OrderNr == targetJobNumber)` never matches a null
    // target, so a null always meant "create a new job".
    let jobId: string | undefined;
    if (targetJobNumber != null) {
      const existing = await sql<{ id: string }>`
        SELECT id FROM domain.repairjob WHERE workid = ${workId}::uuid AND ordernr = ${targetJobNumber}
      `.execute(this.db);
      jobId = existing.rows[0]?.id;
    }

    if (!jobId) {
      jobId = await this.createRepairJob(workId, acceptorId, notes);
    }

    const targetJobId = jobId;

    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE domain.offer SET acceptedon = now(), acceptorid = ${acceptorId}::uuid
         WHERE id = ${offerId}::uuid
      `.execute(tx);

      await this.copySaleables(tx, offerId, targetJobId);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });

    return targetJobId;
  }

  /**
   * `RepairJob.CopySaleablesFrom` — appends the offer's lines after the highest
   * existing line number, copying them into new rows.
   */
  private async copySaleables(tx: Kysely<Database>, offerId: string, jobId: string): Promise<void> {
    const last = await sql<{ last: number | string | null }>`
      SELECT greatest(
        coalesce((SELECT max(jnr) FROM domain.productinstalled WHERE repairjobid = ${jobId}::uuid), 0),
        coalesce((SELECT max(jnr) FROM domain.serviceperformed  WHERE repairjobid = ${jobId}::uuid), 0)
      ) as last
    `.execute(tx);

    let jnr = Number(last.rows[0]?.last ?? 0);

    const lines = await sql<{
      kind: string;
      code: string | null;
      name: string;
      quantity: number;
      unit: string;
      price: number;
      discount: number | null;
    }>`
      SELECT kind, code, name, quantity, unit, price, discount
        FROM (
          SELECT 'product'::text as kind, p.code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
            FROM domain.productoffered p
            inner join domain.saleable s on s.id = p.id
           WHERE p.offerid = ${offerId}::uuid
          union all
          SELECT 'service'::text as kind, null as code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
            FROM domain.serviceoffered p
            inner join domain.saleable s on s.id = p.id
           WHERE p.offerid = ${offerId}::uuid
        ) lines
       ORDER BY jnr, kind
    `.execute(tx);

    for (const line of lines.rows) {
      jnr += 1;
      const lineId = randomUUID();
      await sql`
        INSERT INTO domain.saleable (id, name, quantity, unit, price, discount)
        VALUES (${lineId}::uuid, ${line.name}, ${line.quantity}, ${line.unit}, ${line.price}, ${line.discount})
      `.execute(tx);
      await this.insertSubtype(
        tx,
        'repairjob',
        line.kind === 'service' ? 'service' : 'product',
        lineId,
        jobId,
        jnr,
        line.code ?? '',
      );
    }
  }

  /* ── Line items ─────────────────────────────────────────────────────────── */

  /**
   * `Offer.With(ProductOffered[])` / `RepairJob.With(ProductInstalled[])`.
   *
   * Line numbers come from the request index, not from the posted payload, so a
   * reordered request renumbers the lines.
   */
  async replaceLines(
    kind: Kind,
    ownerId: string,
    lines: readonly SaleableLine[],
  ): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const kept = new Set<string>();

      let jnr = 0;
      for (const line of lines) {
        jnr += 1;

        const name = line.name?.trim();
        if (!name) throw new UserError('Name required.');

        const quantity = Number(line.quantity ?? 0);
        if (!(quantity > 0)) throw new UserError('Quantity must be at least 1.');

        const price = Number(line.price ?? 0);
        const unit = line.unit ?? '';
        const code = line.code ?? '';
        const discount = line.discount ?? null;
        const lineKind: LineKind = line.kind === 'service' ? 'service' : 'product';

        const isTransient = !line.id || line.id === NIL_UUID;

        let lineId: string | null = null;
        if (!isTransient) {
          const updated = await sql`
            UPDATE domain.saleable
               SET name = ${name}, quantity = ${quantity}, unit = ${unit},
                   price = ${price}, discount = ${discount}
             WHERE id = ${line.id}::uuid
          `.execute(tx);

          if (Number(updated.numAffectedRows ?? 0) > 0) {
            lineId = line.id;
          }
          // Unknown id: the posted entity was not transient, so the original
          // would have updated a row that did not exist and silently lost the
          // line. Inserting instead keeps the line visible.
        }

        if (!lineId) {
          lineId = randomUUID();
          await sql`
            INSERT INTO domain.saleable (id, name, quantity, unit, price, discount)
            VALUES (${lineId}::uuid, ${name}, ${quantity}, ${unit}, ${price}, ${discount})
          `.execute(tx);
        }

        // A row keeps its id when its kind changes, so clear whichever subtype
        // row it had and re-insert it under the (possibly new) table.
        await sql`DELETE FROM ${sql.raw(PRODUCT_TABLE[kind])} WHERE id = ${lineId}::uuid`.execute(tx);
        await sql`DELETE FROM ${sql.raw(SERVICE_TABLE[kind])} WHERE id = ${lineId}::uuid`.execute(tx);
        await this.insertSubtype(tx, kind, lineKind, lineId, ownerId, jnr, code);

        kept.add(lineId);
      }

      // Drop every stored line that was not part of the request, from either
      // subtype table, along with its shared `saleable` row.
      for (const table of [PRODUCT_TABLE[kind], SERVICE_TABLE[kind]]) {
        const stored = await sql<{ id: string }>`
          SELECT id FROM ${sql.raw(table)}
           WHERE ${sql.raw(OWNER_COLUMN[kind])} = ${ownerId}::uuid
        `.execute(tx);

        for (const row of stored.rows) {
          if (kept.has(row.id)) continue;
          await sql`DELETE FROM ${sql.raw(table)} WHERE id = ${row.id}::uuid`.execute(tx);
          await sql`DELETE FROM domain.saleable WHERE id = ${row.id}::uuid`.execute(tx);
        }
      }

      // Both `PutProductsOrServices*` actions ended with `Work.Changed()`.
      await this.touch(tx, kind, ownerId);
    });
  }

  /**
   * Inserts the subtype row that turns a `saleable` into a product or service
   * line of an offer or a repair job.
   */
  private async insertSubtype(
    tx: Kysely<Database>,
    kind: Kind,
    lineKind: LineKind,
    id: string,
    ownerId: string,
    jnr: number,
    code: string,
  ): Promise<void> {
    if (lineKind === 'product') {
      if (kind === 'offer') {
        await sql`
          INSERT INTO domain.productoffered (id, offerid, code, jnr)
          VALUES (${id}::uuid, ${ownerId}::uuid, ${code}, ${jnr})
        `.execute(tx);
      } else {
        await sql`
          INSERT INTO domain.productinstalled (id, repairjobid, jnr, code, notes, status)
          VALUES (${id}::uuid, ${ownerId}::uuid, ${jnr}, ${code}, null, 1)
        `.execute(tx);
      }
      return;
    }

    if (kind === 'offer') {
      await sql`
        INSERT INTO domain.serviceoffered (id, offerid, jnr)
        VALUES (${id}::uuid, ${ownerId}::uuid, ${jnr})
      `.execute(tx);
    } else {
      await sql`
        INSERT INTO domain.serviceperformed (id, repairjobid, jnr, notes, mechanicid)
        VALUES (${id}::uuid, ${ownerId}::uuid, ${jnr}, null, null)
      `.execute(tx);
    }
  }

  /**
   * Bumps `domain.work.changedon` for the owner of an activity.
   *
   * The legacy controller called `Work.Changed()` at the end of nearly every
   * mutating action; the search list is ordered by `changedon`, so skipping it
   * would leave edited work orders buried.
   */
  private async touch(tx: Kysely<Database>, kind: Kind, ownerId: string): Promise<void> {
    const owner = await sql<{ workid: string }>`
      SELECT workid FROM ${sql.raw(OWNER_TABLE[kind])} WHERE id = ${ownerId}::uuid
    `.execute(tx);

    const workId = owner.rows[0]?.workid;
    if (!workId) throw new NotFoundError(kind === 'offer' ? 'Offer' : 'Repair job');

    await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
  }

  /** `Work.Assign` — adds the new mechanics, then drops the ones not listed. */
  private async replaceAssignments(
    tx: Kysely<Database>,
    workId: string,
    mechanicIds: readonly string[],
  ): Promise<void> {
    const wanted = [...new Set(mechanicIds)];

    const current = await sql<{ mechanicid: string }>`
      SELECT mechanicid FROM domain.assignment WHERE workid = ${workId}::uuid
    `.execute(tx);

    for (const row of current.rows) {
      if (!wanted.includes(row.mechanicid)) {
        await sql`
          DELETE FROM domain.assignment
           WHERE workid = ${workId}::uuid AND mechanicid = ${row.mechanicid}::uuid
        `.execute(tx);
      }
    }

    for (const mechanicId of wanted) {
      await sql`
        INSERT INTO domain.assignment (workid, mechanicid)
        VALUES (${workId}::uuid, ${mechanicId}::uuid)
        ON CONFLICT DO NOTHING
      `.execute(tx);
    }
  }

  /* ── Invoicing and estimates ────────────────────────────────────────────── */

  /**
   * `Work.GenerateInvoice` / `Invoice.CreateFor`.
   *
   * Lines came from every repair job's products, numbered continuously across
   * jobs. `ApplyVehicleInformation(null)` left the vehicle block blank, which is
   * preserved, and `ApplyClientInformation` kept the client's active email.
   */
  async generateInvoice(input: {
    workId: string;
    vatRate: number;
    paymentType: number;
    dueDays: number;
    issuerId: string;
  }): Promise<{ invoiceId: string; clientEmail: string | null; fileName: string }> {
    const work = await this.findOrFail(input.workId);

    return withSequence(this.db, 'invoice', async (number, tx) => {
      const invoiceId = randomUUID();

      const lines = await sql<PricingLineSource>`
        SELECT name, quantity, unit, price, discount
          FROM (
            SELECT rj.ordernr AS workordernr, pi.jnr AS jnr, s.name, s.quantity, s.unit, s.price, s.discount
              FROM domain.repairjob rj
              inner join domain.productinstalled pi ON pi.repairjobid = rj.id
              inner join domain.saleable s ON s.id = pi.id
             WHERE rj.workid = ${input.workId}::uuid
            union all
            SELECT rj.ordernr AS workordernr, sp.jnr AS jnr, s.name, s.quantity, s.unit, s.price, s.discount
              FROM domain.repairjob rj
              inner join domain.serviceperformed sp ON sp.repairjobid = rj.id
              inner join domain.saleable s ON s.id = sp.id
             WHERE rj.workid = ${input.workId}::uuid
          ) worklines
         ORDER BY workordernr, jnr
      `.execute(tx);

      // `domain.invoice.id` references `domain.pricing`, so the base row has to
      // be inserted first.
      await sql`
        INSERT INTO domain.pricing
          (id, senton, printedon, email, partyname, partyaddress, partycode,
           vehicleline1, vehicleline2, vehicleline3, vehicleline4, issuedon, issuerid)
        VALUES (
          ${invoiceId}::uuid, null, null,
          ${work.clientEmail},
          ${work.clientName ?? 'eraisik'},
          ${work.clientAddress},
          ${await this.partyCode(tx, input.workId)},
          '', '', '', '',
          now(),
          ${input.issuerId}::uuid
        )
      `.execute(tx);

      await sql`
        INSERT INTO domain.invoice (id, number, paymenttype, duedays, ispaid, iscredited)
        VALUES (${invoiceId}::uuid, ${number}, ${input.paymentType}, ${input.dueDays}, false, false)
      `.execute(tx);

      await this.insertPricingLines(tx, input.vatRate, invoiceId, lines.rows);

      await sql`
        UPDATE domain.work SET invoiceid = ${invoiceId}::uuid, changedon = now()
         WHERE id = ${input.workId}::uuid
      `.execute(tx);

      return {
        invoiceId,
        clientEmail: work.clientEmail,
        fileName: `invoice_nr_${number}.pdf`,
      };
    });
  }

  /**
   * `WorkController.IssueEstimate` / `Work.Issue`.
   *
   * Re-issuing an already-issued offer copied it first — and the copy is numbered
   * from the target work's current maximum, so it gets a *new* order number and
   * therefore a new estimate number. That keeps an already-sent estimate number
   * from ever referring to different content.
   */
  async issueEstimate(input: {
    workId: string;
    offerNumber: number;
    vatRate: number;
    issuerId: string;
    showVehicleOnPricing: boolean;
  }): Promise<{ offerId: string; estimateId: string; estimateNumber: string; fileName: string }> {
    const work = await this.findOrFail(input.workId);
    const sourceOfferId = await this.findActivityId('offer', input.workId, input.offerNumber);

    const issued = await sql<{ estimateid: string | null }>`
      SELECT estimateid FROM domain.offer WHERE id = ${sourceOfferId}::uuid
    `.execute(this.db);

    const estimateId = randomUUID();

    let offerId = sourceOfferId;
    let offerOrderNr = input.offerNumber;

    await this.db.transaction().execute(async (tx) => {
      if (issued.rows[0]?.estimateid) {
        offerId = await this.copyOffer(tx, sourceOfferId, input.workId, input.issuerId);
        const copied = await sql<{ ordernr: number }>`
          SELECT ordernr FROM domain.offer WHERE id = ${offerId}::uuid
        `.execute(tx);
        offerOrderNr = Number(copied.rows[0]?.ordernr ?? 0);
      }

      // Lines of the (possibly just-copied) offer, products and services
      // interleaved by their stored line number.
      const lines = await sql<PricingLineSource>`
        SELECT name, quantity, unit, price, discount
          FROM (
            SELECT p.jnr AS jnr, s.name, s.quantity, s.unit, s.price, s.discount
              FROM domain.productoffered p
              inner join domain.saleable s ON s.id = p.id
             WHERE p.offerid = ${offerId}::uuid
            union all
            SELECT sp.jnr AS jnr, s.name, s.quantity, s.unit, s.price, s.discount
              FROM domain.serviceoffered sp
              inner join domain.saleable s ON s.id = sp.id
             WHERE sp.offerid = ${offerId}::uuid
          ) offerlines
         ORDER BY jnr
      `.execute(tx);

      const number = estimateNumber(Number(work.number), offerOrderNr);

      // `Estimate.CreateFor` filled the vehicle block from `offer.Work.Vehicle`,
      // so the odometer came from the *vehicle*, not from the work order.
      const vehicle = await sql<{ odo: number | null }>`
        SELECT v.odo
          FROM domain.work w
          LEFT JOIN domain.vehicle v ON v.id = w.vehicleid
         WHERE w.id = ${input.workId}::uuid
      `.execute(tx);
      const vehicleOdo = vehicle.rows[0]?.odo ?? null;

      // `Estimate.CreateFor` copied the client, wiped `senton`/`email` again and
      // only filled the vehicle block when the offer asked for it.
      await sql`
        INSERT INTO domain.pricing
          (id, senton, printedon, email, partyname, partyaddress, partycode,
           vehicleline1, vehicleline2, vehicleline3, vehicleline4, issuedon, issuerid)
        VALUES (
          ${estimateId}::uuid, null, null, null,
          ${work.clientName ?? 'eraisik'},
          ${work.clientAddress},
          ${await this.partyCode(tx, input.workId)},
          ${input.showVehicleOnPricing ? `Sõiduk: ${work.vehicleProducer ?? ''} ${work.vehicleModel ?? ''}` : ''},
          ${input.showVehicleOnPricing ? `Reg nr: ${work.vehicleRegNr ?? ''}` : ''},
          ${input.showVehicleOnPricing ? `Odomeetri näit: ${vehicleOdo ?? ''}` : ''},
          ${input.showVehicleOnPricing ? `VIN: ${work.vehicleVin ?? ''}` : ''},
          now(),
          ${input.issuerId}::uuid
        )
      `.execute(tx);

      await sql`
        INSERT INTO domain.estimate (id, number) VALUES (${estimateId}::uuid, ${number})
      `.execute(tx);

      // `Offer.DisplayVehicleOnEstimate` ran before the estimate was built, so the
      // flag always took the posted value; the estimate row now exists for the FK.
      await sql`
        UPDATE domain.offer SET
          estimateid = ${estimateId}::uuid,
          isvehilelinesonestimate = ${input.showVehicleOnPricing}
        WHERE id = ${offerId}::uuid
      `.execute(tx);

      await this.insertPricingLines(tx, input.vatRate, estimateId, lines.rows);

      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${input.workId}::uuid`.execute(tx);
    });

    return {
      offerId,
      estimateId,
      estimateNumber: estimateNumber(Number(work.number), offerOrderNr),
      fileName: `estimate_nr_${estimateNumber(Number(work.number), offerOrderNr)}.pdf`,
    };
  }

  private async insertPricingLines(
    tx: Kysely<Database>,
    vatRate: number,
    pricingId: string,
    lines: readonly PricingLineSource[],
  ): Promise<void> {
    let nr = 0;
    for (const line of lines) {
      nr += 1;
      const pricingLine = toPricingLine(vatRate, nr, line);
      await sql`
        INSERT INTO domain.pricingline
          (pricingid, nr, description, quantity, unitprice, unit, discount, total, totalwithvat)
        VALUES (
          ${pricingId}::uuid, ${pricingLine.nr}, ${pricingLine.description},
          ${pricingLine.quantity}, ${pricingLine.unitPrice}, ${pricingLine.unit},
          ${pricingLine.discount}, ${pricingLine.total}, ${pricingLine.totalWithVat}
        )
      `.execute(tx);
    }
  }

  /** `Client.RegCode` — the legal client's registration or the private personal code. */
  private async partyCode(tx: Kysely<Database>, workId: string): Promise<string | null> {
    const result = await sql<{ partycode: string | null }>`
      SELECT coalesce(l.regnr, p.personalcode) as partycode
        FROM domain.work w
        left join domain.legalclient l on l.id = w.clientid
        left join domain.privateclient p on p.id = w.clientid
       WHERE w.id = ${workId}::uuid
    `.execute(tx);
    return result.rows[0]?.partycode ?? null;
  }

  /** `Invoice.MarkPaid`. */
  async markInvoicePaid(workId: string, isPaid: boolean): Promise<void> {
    const invoiceId = await this.invoiceIdOf(workId);
    await this.db.transaction().execute(async (tx) => {
      await sql`UPDATE domain.invoice SET ispaid = ${isPaid} WHERE id = ${invoiceId}::uuid`.execute(tx);
      await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
    });
  }

  /**
   * `Pricing.Send` — stamps the recipient and `senton` before the mail leaves,
   * so a failed send still leaves a trace of the attempt.
   */
  async markPricingSent(pricingId: string, email: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE domain.pricing SET senton = now(), email = ${email} WHERE id = ${pricingId}::uuid
      `.execute(tx);

      // `SendInvoice`/`SendEstimate` both finished with `Work.Changed()`. An
      // estimate hangs off an offer, an invoice straight off the work order.
      const owner = await sql<{ workid: string }>`
        SELECT w.id as workid
          FROM domain.work w
         WHERE w.invoiceid = ${pricingId}::uuid
        UNION ALL
        SELECT o.workid
          FROM domain.offer o
         WHERE o.estimateid = ${pricingId}::uuid
        LIMIT 1
      `.execute(tx);

      const workId = owner.rows[0]?.workid;
      if (workId) {
        await sql`UPDATE domain.work SET changedon = now() WHERE id = ${workId}::uuid`.execute(tx);
      }
    });
  }

  /** The work order's invoice id, or a user error when it has not been invoiced. */
  async invoiceIdOf(workId: string): Promise<string> {
    const result = await sql<{ invoiceid: string | null }>`
      SELECT invoiceid FROM domain.work WHERE id = ${workId}::uuid
    `.execute(this.db);

    const invoiceId = result.rows[0]?.invoiceid ?? null;
    if (!invoiceId) throw new UserError('Work has no invoice.');
    return invoiceId;
  }

  /**
   * `Work.DeleteInvoice`. Consuming the next number is the whole point: only the
   * newest invoice may be withdrawn so numbers stay contiguous.
   */
  async cancelInvoice(workId: string): Promise<{ invoiceId: string; fileName: string }> {
    const invoiceId = await this.invoiceIdOf(workId);

    return withSequence(this.db, 'invoice', async (next, tx) => {
      const current = await sql<{ number: number | string }>`
        SELECT number FROM domain.invoice WHERE id = ${invoiceId}::uuid
      `.execute(tx);

      const number = Number(current.rows[0]?.number ?? 0);
      if (next !== number + 1) {
        throw new UserError('Cannot delete an invoice, only last invoice can be deleted.');
      }

      await sql`DELETE FROM domain.pricingline WHERE pricingid = ${invoiceId}::uuid`.execute(tx);
      // `domain.invoice.id` references `domain.pricing`, so the subtype row has to
      // go first.
      await sql`DELETE FROM domain.invoice WHERE id = ${invoiceId}::uuid`.execute(tx);
      await sql`DELETE FROM domain.pricing WHERE id = ${invoiceId}::uuid`.execute(tx);
      await sql`
        UPDATE domain.work SET invoiceid = null, changedon = now() WHERE id = ${workId}::uuid
      `.execute(tx);

      return { invoiceId, fileName: `invoice_nr_${number}.pdf` };
    });
  }

  /** `Offer.MakeCopy` — notes, vehicle-line flag and lines, numbered from the target work. */
  private async copyOffer(
    tx: Kysely<Database>,
    sourceId: string,
    newWorkId: string,
    starterId: string,
  ): Promise<string> {
    const source = await sql<{ notes: string | null; isvehilelinesonestimate: boolean }>`
      SELECT notes, isvehilelinesonestimate FROM domain.offer WHERE id = ${sourceId}::uuid
    `.execute(tx);

    const next = await sql<{ next: number | string }>`
      SELECT coalesce(max(ordernr), -1) + 1 as next FROM domain.offer WHERE workid = ${newWorkId}::uuid
    `.execute(tx);

    const newId = randomUUID();
    await sql`
      INSERT INTO domain.offer (id, workid, ordernr, notes, estimateid, isvehilelinesonestimate, startedon, starterid)
      VALUES (
        ${newId}::uuid, ${newWorkId}::uuid, ${Number(next.rows[0]?.next ?? 0)},
        ${source.rows[0]?.notes ?? null}, null, ${source.rows[0]?.isvehilelinesonestimate ?? false},
        now(), ${starterId}::uuid
      )
    `.execute(tx);

    await this.copyProductLines(tx, 'offer', sourceId, newId);
    return newId;
  }

  /** `WorkController.MakeCopy` — duplicates the order with its jobs and offers. */
  async makeCopy(workId: string, starterId: string): Promise<string> {
    const source = await this.findOrFail(workId);
    const newId = randomUUID();

    await withSequence(this.db, 'work', async (number, tx) => {
      await sql`
        INSERT INTO domain.work
          (id, number, clientid, vehicleid, startedon, changedon, starterid, notes, odo, userstatus)
        VALUES (
          ${newId}::uuid, ${number}, ${source.clientId}::uuid, ${source.vehicleId}::uuid,
          now(), now(), ${starterId}::uuid, ${source.notes}, ${source.odo}, 'Default'
        )
      `.execute(tx);

      // The original copied jobs before offers; the order is irrelevant to the
      // result but is kept so a failure leaves the same partial state.
      const jobs = await sql<{ id: string }>`
        SELECT id FROM domain.repairjob WHERE workid = ${workId}::uuid ORDER BY ordernr
      `.execute(tx);
      for (const job of jobs.rows) {
        await this.copyRepairJob(tx, job.id, newId, starterId);
      }

      const offers = await sql<{ id: string }>`
        SELECT id FROM domain.offer WHERE workid = ${workId}::uuid ORDER BY ordernr
      `.execute(tx);
      for (const offer of offers.rows) {
        await this.copyOffer(tx, offer.id, newId, starterId);
      }
    });

    return newId;
  }

  private async copyRepairJob(
    tx: Kysely<Database>,
    sourceId: string,
    newWorkId: string,
    starterId: string,
  ): Promise<void> {
    const source = await sql<{ notes: string | null }>`
      SELECT notes FROM domain.repairjob WHERE id = ${sourceId}::uuid
    `.execute(tx);

    const next = await sql<{ next: number | string }>`
      SELECT coalesce(max(ordernr), -1) + 1 as next FROM domain.repairjob WHERE workid = ${newWorkId}::uuid
    `.execute(tx);

    const newId = randomUUID();
    await sql`
      INSERT INTO domain.repairjob (id, workid, ordernr, notes, startedon, starterid)
      VALUES (
        ${newId}::uuid, ${newWorkId}::uuid, ${Number(next.rows[0]?.next ?? 0)},
        ${source.rows[0]?.notes ?? null}, now(), ${starterId}::uuid
      )
    `.execute(tx);

    await this.copyProductLines(tx, 'repairjob', sourceId, newId);
  }

  /** Copies lines verbatim, keeping their line numbers. */
  private async copyProductLines(
    tx: Kysely<Database>,
    kind: Kind,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    const lines = await sql<PricingLineSource & { code: string | null; jnr: number; kind: string }>`
      SELECT kind, code, jnr, name, quantity, unit, price, discount
        FROM (
          SELECT 'product'::text as kind, p.code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
            FROM ${sql.raw(PRODUCT_TABLE[kind])} p
            inner join domain.saleable s ON s.id = p.id
           WHERE p.${sql.raw(OWNER_COLUMN[kind])} = ${sourceId}::uuid
          union all
          SELECT 'service'::text as kind, null as code, p.jnr, s.name, s.quantity, s.unit, s.price, s.discount
            FROM ${sql.raw(SERVICE_TABLE[kind])} p
            inner join domain.saleable s ON s.id = p.id
           WHERE p.${sql.raw(OWNER_COLUMN[kind])} = ${sourceId}::uuid
        ) lines
       ORDER BY jnr, kind
    `.execute(tx);

    for (const line of lines.rows) {
      const lineId = randomUUID();
      await sql`
        INSERT INTO domain.saleable (id, name, quantity, unit, price, discount)
        VALUES (${lineId}::uuid, ${line.name}, ${line.quantity}, ${line.unit}, ${line.price}, ${line.discount})
      `.execute(tx);

      await this.insertSubtype(
        tx,
        kind,
        line.kind === 'service' ? 'service' : 'product',
        lineId,
        targetId,
        line.jnr,
        line.code ?? '',
      );
    }
  }

  /* ── Pricing reads, used by the pricings controller ─────────────────────── */

  /** `PricingsController.GetAllOfferPricings`. */
  async offerIssuances(workId: string): Promise<OfferIssuance[]> {
    const result = await sql<{
      id: string;
      number: string;
      senton: Date | string | null;
      issuedon: Date | string | null;
      receiveremail: string | null;
      issuedby: string | null;
      acceptedon: Date | string | null;
      acceptedby: string | null;
    }>`
      SELECT o.id,
             est.number,
             e.senton,
             e.issuedon,
             e.email as receiveremail,
             concat_ws(' ', i.firstname, i.lastname) as issuedby,
             o.acceptedon,
             (select concat_ws(' ', e2.firstname, e2.lastname)
                from domain.employee e2 where e2.id = o.acceptorid) as acceptedby
        FROM domain.offer o
          inner join domain.pricing e ON e.id = o.estimateid
          inner join domain.estimate est ON est.id = o.estimateid
          inner join domain.employee i ON i.id = e.issuerid
       WHERE o.workid = ${workId}::uuid
    `.execute(this.db);

    return result.rows.map((row) => ({
      id: row.id,
      number: row.number ?? null,
      sentOn: iso(row.senton),
      issuedOn: iso(row.issuedon),
      receiverEmail: row.receiveremail,
      issuedBy: row.issuedby,
      acceptedOn: iso(row.acceptedon),
      acceptedBy: row.acceptedby,
    }));
  }

  /** Estimate id behind an offer, for `pricings/offer/{offerId}/{type}`. */
  async estimateIdOfOffer(offerId: string): Promise<string | null> {
    const result = await sql<{ estimateid: string | null }>`
      SELECT estimateid FROM domain.offer WHERE id = ${offerId}::uuid
    `.execute(this.db);
    return result.rows[0]?.estimateid ?? null;
  }
}

/* ── Row shapes ───────────────────────────────────────────────────────────── */

interface WorkDetailRow {
  id: string;
  number: number;
  startedon: Date | string | null;
  startedby: string | null;
  clientname: string | null;
  clientaddress: string | null;
  clientphone: string | null;
  clientemail: string | null;
  clientid: string | null;
  vehicleid: string | null;
  vehicleproducer: string | null;
  vehiclemodel: string | null;
  vehiclevin: string | null;
  vehicleregnr: string | null;
  notes: string | null;
  odo: number | string | null;
  status: string;
  invoicenumber: number | string | null;
  duedays: number | string | null;
  ispaid: boolean | null;
  senton: Date | string | null;
  issuedon: Date | string | null;
  invoiceissuedby: string | null;
  invoiceemail: string | null;
  offerhasproducts: boolean;
  jobhasproducts: boolean;
}

interface ActivityRow {
  id: string;
  number: string;
  startedon: Date | string | null;
  name: 'offer' | 'repairjob';
  startedby: string | null;
  notes: string | null;
  isvehiclelinesonpricing: boolean;
  isempty: boolean;
}

interface SaleableRow {
  id: string;
  code: string | null;
  kind?: string | null;
  jnr?: number | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  discount: number | null;
}

interface PricingLineSource {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discount: number | null;
}

interface WorkPageRow {
  id: string;
  worknr: number | string;
  startedon: Date | string | null;
  status: string;
  clientid: string | null;
  clientname: string | null;
  vehicleid: string | null;
  regnr: string | null;
  mechanicnames: string | null;
  notes: string | null;
  hasrepairs?: boolean | null;
  numberofoffers?: number | string | null;
  offerissuance?: OfferIssuance | null;
  issuance?: WorkIssuance | null;
}
