import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../types.js';

/**
 * Maintenance-history queries for `GET /api/vehicles/{id}/history` and
 * `GET /api/clients/{id}/history`.
 *
 * There is no legacy controller for these; they are additive. A work order is
 * the unit of history: it carries the vehicle, client, mechanics, and the
 * offers (estimates) and the invoice that were ever issued on it. Everything
 * is fetched in a handful of bulk queries per history and assembled in
 * memory, keeping the SQL straightforward.
 */

/* ── Row shapes ──────────────────────────────────────────────────────────── */

/** Vehicle plus its current owner (the registration with `datetimeto is null`). */
interface VehicleHeaderRow {
  id: string;
  regnr: string;
  producer: string | null;
  model: string | null;
  vin: string | null;
  odo: number | null;
  lownerid: string | null;
  pownerid: string | null;
  lname: string | null;
  pfirstname: string | null;
  plastname: string | null;
}

/** A single history work order row, typed from the raw projection. */
interface WorkHistoryRow {
  id: string;
  number: number;
  startedon: Date;
  completedon: Date | null;
  userstatus: string;
  invoiceid: string | null;
  notes: string | null;
  odo: number | null;
  regnr: string | null;
  vehicleid: string | null;
  clientid: string | null;
  clientname: string | null;
  mechanicnames: string | null;
}

interface ActivityHistoryRow {
  id: string;
  workid: string;
  ordernr: number;
  name: 'offer' | 'repairjob';
  startedon: Date | string;
  startedby: string | null;
  notes: string | null;
}

interface OfferHistoryRow {
  workid: string;
  id: string;
  ordernr: number;
  number: string | null;
  issuedon: Date | string | null;
  senton: Date | string | null;
  acceptedon: Date | string | null;
  totalwithvat: number | string | null;
}

interface InvoiceHistoryRow {
  workid: string;
  id: string;
  number: number;
  issuedon: Date | string | null;
  senton: Date | string | null;
  paid: boolean;
  duedays: number;
  totalwithvat: number | string | null;
}

/** The client header row for `clientHistory`, typed from the raw projection. */
interface ClientHeaderRow {
  id: string;
  phone: string | null;
  isprivate: boolean;
  currentemail: string | null;
  lname: string | null;
  lregnr: string | null;
  pfirstname: string | null;
  plastname: string | null;
}

interface ClientVehicleRow {
  id: string;
  regnr: string;
  producer: string | null;
  model: string | null;
  vin: string | null;
}

/** Camel-cased vehicle as returned by the client history endpoint. */
interface ClientVehicle {
  id: string;
  regNr: string;
  producer: string | null;
  model: string | null;
  vin: string | null;
}

/** `HistoryRow`/`DashboardRow` dates can come back as `Date` (timestamptz). */
function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** `double precision` totals can arrive as strings through pg. */
function num(value: number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

const WORK_PROJECTION = `
  select w.id, w.number, w.startedon, w.completedon, w.userstatus, w.invoiceid,
         w.notes, w.odo, w.vehicleid, v.regnr, w.clientid,
         concat_ws(' ', pp.firstname, pp.lastname, ll.name) as clientname,
         (select string_agg(concat_ws(' ', m.firstname, m.lastname), '/ ')
            from domain.assignment a
            inner join domain.employee m on m.id = a.mechanicid
           where a.workid = w.id) as mechanicnames
    from domain.work w
    left join domain.vehicle v on v.id = w.vehicleid
    left join domain.legalclient ll on ll.id = w.clientid
    left join domain.privateclient pp on pp.id = w.clientid
`;

export interface HistoryActivity {
  id: string;
  orderNr: number;
  name: 'offer' | 'repairjob';
  startedOn: string;
  startedBy: string | null;
  notes: string | null;
}

export interface HistoryOffer {
  id: string;
  orderNr: number;
  number: string | null;
  issuedOn: string | null;
  sentOn: string | null;
  acceptedOn: string | null;
  totalWithVat: number;
}

export interface HistoryInvoice {
  id: string;
  number: number | null;
  issuedOn: string | null;
  sentOn: string | null;
  paid: boolean;
  dueDays: number;
  totalWithVat: number;
}

export interface HistoryWork {
  id: string;
  workNr: string;
  startedOn: string;
  completedOn: string | null;
  status: string;
  userStatus: string | null;
  notes: string | null;
  odo: number | null;
  regNr: string | null;
  vehicleId: string | null;
  clientId: string | null;
  clientName: string | null;
  mechanicNames: string | null;
  activities: HistoryActivity[];
  offers: HistoryOffer[];
  invoices: HistoryInvoice[];
}

export interface VehicleHistory {
  vehicle: { id: string; regNr: string; producer: string | null; model: string | null; vin: string | null; odo: number | null };
  client: { id: string | null; name: string | null };
  workOrders: HistoryWork[];
}

export interface ClientHistory {
  client: {
    id: string;
    name: string | null;
    isPrivate: boolean;
    phone: string | null;
    email: string | null;
    regNr: string | null;
  };
  vehicles: ClientVehicle[];
  workOrders: HistoryWork[];
}

export class HistoryRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async vehicleHistory(id: string): Promise<VehicleHistory | undefined> {
    const header = await sql<VehicleHeaderRow>`
      select v.id, v.regnr, v.producer, v.model, v.vin, v.odo,
             l.id as lownerid, l.name as lname,
             p.id as pownerid, p.firstname as pfirstname, p.lastname as plastname
        from domain.vehicle v
        left join domain.vehicleregistration vr on vr.vehicleid = v.id and vr.datetimeto is null
        left join domain.legalclient l on l.id = vr.ownerid
        left join domain.privateclient p on p.id = vr.ownerid
       where v.id = ${id}::uuid
    `.execute(this.db);

    const vehicle = header.rows[0];
    if (!vehicle) return undefined;

    const works = await sql<WorkHistoryRow>`
      ${sql.raw(WORK_PROJECTION)}
       where w.vehicleid = ${id}::uuid
       order by w.startedon desc
    `.execute(this.db);

    const workOrders = await this.assemble(works.rows);
    const ownerId = vehicle.lownerid ?? vehicle.pownerid;
    const ownerName =
      vehicle.lname || [vehicle.pfirstname, vehicle.plastname].filter(Boolean).join(' ') || null;

    return {
      vehicle: {
        id: vehicle.id,
        regNr: vehicle.regnr,
        producer: vehicle.producer,
        model: vehicle.model,
        vin: vehicle.vin,
        odo: vehicle.odo,
      },
      client: { id: ownerId, name: ownerName },
      workOrders,
    };
  }

  async clientHistory(id: string): Promise<ClientHistory | undefined> {
    const header = await sql<ClientHeaderRow>`
      select c.id, c.phone,
             (p.id is not null) as isprivate,
             (select ce.address from domain.clientemail ce
               where ce.clientid = c.id and ce.isactive limit 1) as currentemail,
             l.name as lname, l.regnr as lregnr,
             p.firstname as pfirstname, p.lastname as plastname
        from domain.client c
        left join domain.legalclient l on l.id = c.id
        left join domain.privateclient p on p.id = c.id
       where c.id = ${id}::uuid
    `.execute(this.db);

    const client = header.rows[0];
    if (!client) return undefined;

    const vehicles = await sql<ClientVehicleRow>`
      select v.id, v.regnr, v.producer, v.model, v.vin
        from domain.vehicleregistration vr
        inner join domain.vehicle v on v.id = vr.vehicleid
       where vr.ownerid = ${id}::uuid and vr.datetimeto is null
       order by v.regnr
    `.execute(this.db);

    const works = await sql<WorkHistoryRow>`
      ${sql.raw(WORK_PROJECTION)}
       where w.clientid = ${id}::uuid
       order by w.startedon desc
    `.execute(this.db);

    const workOrders = await this.assemble(works.rows);
    const name =
      client.lname || [client.pfirstname, client.plastname].filter(Boolean).join(' ') || null;

    return {
      client: {
        id: client.id,
        name,
        isPrivate: client.isprivate,
        phone: client.phone,
        email: client.currentemail,
        regNr: client.lregnr,
      },
      vehicles: vehicles.rows.map((vehicle) => ({
        id: vehicle.id,
        regNr: vehicle.regnr,
        producer: vehicle.producer,
        model: vehicle.model,
        vin: vehicle.vin,
      })),
      workOrders,
    };
  }

  /**
   * Fills activities, offers and invoices for the given work orders. The
   * queries are keyed by `workid`, so `assemble` maps them back onto rows.
   */
  private async assemble(rows: WorkHistoryRow[]): Promise<HistoryWork[]> {
    if (rows.length === 0) return [];

    const ids = sql`${sql.join(rows.map((row) => sql`${row.id}::uuid`), sql`, `)}`;

    const [activities, offers, invoices] = await Promise.all([
      this.loadActivities(ids),
      this.loadOffers(ids),
      this.loadInvoices(ids),
    ]);

    return rows.map((row) => ({
      id: row.id,
      workNr: String(row.number),
      startedOn: iso(row.startedon) ?? '',
      completedOn: iso(row.completedon),
      status:
        row.invoiceid != null ? 'completed' : row.userstatus.toLowerCase(),
      userStatus: row.userstatus,
      notes: row.notes,
      odo: row.odo,
      regNr: row.regnr,
      vehicleId: row.vehicleid,
      clientId: row.clientid,
      clientName: row.clientname,
      mechanicNames: row.mechanicnames,
      activities: activities.get(row.id) ?? [],
      offers: offers.get(row.id) ?? [],
      invoices: invoices.get(row.id) ?? [],
    }));
  }

  private async loadActivities(ids: RawBuilder<unknown>): Promise<Map<string, HistoryActivity[]>> {
    const result = await sql<ActivityHistoryRow>`
      select a.id, a.workid, a.ordernr, a.startedon, a.name,
             concat_ws(' ', e.firstname, e.lastname) as startedby, a.notes
        from (
          select o.id, o.workid, o.ordernr, o.startedon, o.starterid,
                 'offer'::text as name, o.notes
            from domain.offer o
          union all
          select rj.id, rj.workid, rj.ordernr, rj.startedon, rj.starterid,
                 'repairjob'::text as name, rj.notes
            from domain.repairjob rj
        ) a
        inner join domain.employee e on e.id = a.starterid
       where a.workid = any(array[${ids}]::uuid[])
       order by a.startedon desc
    `.execute(this.db);

    return groupByWork(result.rows, (row) => ({
      id: row.id,
      orderNr: row.ordernr,
      name: row.name,
      startedOn: iso(row.startedon) ?? '',
      startedBy: row.startedby,
      notes: row.notes,
    }));
  }

  private async loadOffers(ids: RawBuilder<unknown>): Promise<Map<string, HistoryOffer[]>> {
    const result = await sql<OfferHistoryRow>`
      select o.workid, o.id, o.ordernr, e.number,
             p.issuedon, p.senton, o.acceptedon,
             (select coalesce(sum(pl.totalwithvat), 0) from domain.pricingline pl
               where pl.pricingid = o.estimateid) as totalwithvat
        from domain.offer o
        inner join domain.estimate e on e.id = o.estimateid
        inner join domain.pricing p on p.id = o.estimateid
       where o.workid = any(array[${ids}]::uuid[])
       order by p.issuedon
    `.execute(this.db);

    return groupByWork(result.rows, (row) => ({
      id: row.id,
      orderNr: row.ordernr,
      number: row.number,
      issuedOn: iso(row.issuedon),
      sentOn: iso(row.senton),
      acceptedOn: iso(row.acceptedon),
      totalWithVat: num(row.totalwithvat),
    }));
  }

  private async loadInvoices(ids: RawBuilder<unknown>): Promise<Map<string, HistoryInvoice[]>> {
    const result = await sql<InvoiceHistoryRow>`
      select w.id as workid, i.id, i.number, p.issuedon, p.senton,
             i.ispaid, i.duedays,
             (select coalesce(sum(pl.totalwithvat), 0) from domain.pricingline pl
               where pl.pricingid = i.id) as totalwithvat
        from domain.work w
        inner join domain.invoice i on i.id = w.invoiceid
        inner join domain.pricing p on p.id = i.id
       where w.id = any(array[${ids}]::uuid[])
       order by p.issuedon
    `.execute(this.db);

    return groupByWork(result.rows, (row) => ({
      id: row.id,
      number: row.number,
      issuedOn: iso(row.issuedon),
      sentOn: iso(row.senton),
      paid: row.paid,
      dueDays: row.duedays,
      totalWithVat: num(row.totalwithvat),
    }));
  }
}

/** Groups rows by `workid`, mapping each into its history item. */
function groupByWork<T extends { workid: string }, U>(
  rows: T[],
  into: (row: T) => U,
): Map<string, U[]> {
  const map = new Map<string, U[]>();
  for (const row of rows) {
    const items = map.get(row.workid) ?? [];
    items.push(into(row));
    map.set(row.workid, items);
  }
  return map;
}