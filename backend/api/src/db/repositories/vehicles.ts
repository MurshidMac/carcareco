import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { PageQuery, type PageResult } from '../../core/paging.js';
import { NotFoundError } from '../../core/errors.js';

/**
 * Port of `VehiclesController`.
 *
 * Ownership is a temporal association: `domain.vehicleregistration` keeps the
 * history and the owner is whichever row has `datetimeto is null`. `RegisterTo`
 * ended the previous row instead of deleting it, so that history is preserved
 * here as well.
 *
 * Note `VehiclesController` carried no `[Authorize]` at the class level, so
 * `GET /{id}`, `GET /page`, `POST` and `GET /client/{clientId}` were reachable
 * with any valid token while `PUT` and `DELETE` required the Root role.
 */

export interface VehicleRecord {
  id: string;
  producer: string | null;
  model: string | null;
  regNr: string | null;
  vin: string | null;
  odo: number | null;
  body: string | null;
  drivingSide: string | null;
  engine: string | null;
  productionDate: string | null;
  region: string | null;
  series: string | null;
  transmission: string | null;
  ownerId: string | null;
  ownerName: string | null;
  description: string | null;
  introducedAt: string | null;
}

export interface VehiclePageItem {
  id: string;
  producer: string | null;
  model: string | null;
  regNr: string | null;
  vin: string | null;
  body: string | null;
  engine: string | null;
  productionDate: string | null;
  region: string | null;
  series: string | null;
  transmission: string | null;
  ownerName: string | null;
  ownerId: string | null;
}

/** `VehiclePageItem` in its raw database column shape. */
interface VehiclePageRow {
  id: string;
  producer: string | null;
  model: string | null;
  regnr: string | null;
  vin: string | null;
  body: string | null;
  engine: string | null;
  productiondate: string | null;
  region: string | null;
  series: string | null;
  transmission: string | null;
  ownername: string | null;
  ownerid: string | null;
}

export interface ClientVehicle {
  id: string;
  ownerId: string | null;
  producer: string | null;
  model: string | null;
  regNr: string | null;
  vin: string | null;
}

/** `ClientVehicle` in its raw database column shape. */
interface ClientVehicleRow {
  id: string;
  ownerid: string | null;
  producer: string | null;
  model: string | null;
  regnr: string | null;
  vin: string | null;
}

const PAGE_PROJECTION = `
  SELECT
    v.id,
    v.regnr, v.vin, v.producer, v.model, v.body, v.drivingside, v.engine,
    TO_CHAR(v.productiondate,'MM-YYYY') as productiondate, v.region, v.series, v.transmission,
    concat_ws(' ', p.firstname, p.lastname, l.name) as ownername,
    v0.ownerid as ownerid
  FROM domain.vehicle AS v
    left join domain.vehicleregistration v0 on v.id = v0.vehicleid AND v0.datetimeto IS NULL
    left join domain.legalclient l on l.id = v0.ownerid
    left join domain.privateclient p on p.id = v0.ownerid
`;

const SEARCH_FIELDS =
  "concat_ws(' ',v.regnr,v.vin,p.firstname,p.lastname,l.name,v.producer,v.model)";

/** `varchar` timestamps arrive as strings; `timestamptz` as `Date`. */
function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export class VehicleRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `VehiclesController.GetPage`. */
  async page(params: {
    searchText?: string | undefined;
    orderby?: string | undefined;
    limit: number;
    offset: number;
    desc: boolean;
  }): Promise<PageResult<VehiclePageItem>> {
    const result = await new PageQuery(params, {
      allowedOrderBy: [
        'id',
        'regnr',
        'vin',
        'producer',
        'model',
        'body',
        'drivingside',
        'engine',
        'productiondate',
        'region',
        'series',
        'transmission',
        'ownername',
        'ownerid',
      ],
      defaultOrderBy: 'regnr',
    })
      .searchFields(SEARCH_FIELDS)
      .execute<VehiclePageRow>(this.db, PAGE_PROJECTION);

    return {
      hasMore: result.hasMore,
      items: result.items.map((row) => ({
        id: row.id,
        producer: row.producer,
        model: row.model,
        regNr: row.regnr,
        vin: row.vin,
        body: row.body,
        engine: row.engine,
        productionDate: row.productiondate,
        region: row.region,
        series: row.series,
        transmission: row.transmission,
        ownerName: row.ownername,
        ownerId: row.ownerid,
      })),
    };
  }

  /** `VehiclesController.ClientVehicles` — only currently effective registrations. */
  async forClient(clientId: string): Promise<ClientVehicle[]> {
    const result = await sql<ClientVehicleRow>`
      select v.producer, v.model, v.regnr, v.vin, v.id, r.ownerid
        from domain.vehicleregistration r
        inner join domain.vehicle v on v.id = r.vehicleid
       where r.ownerid = ${clientId}::uuid
         and r.datetimeto is null
    `.execute(this.db);

    return result.rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerid,
      producer: row.producer,
      model: row.model,
      regNr: row.regnr,
      vin: row.vin,
    }));
  }

  async find(id: string): Promise<VehicleRecord | undefined> {
    const result = await sql<VehicleRow>`
      SELECT
        v.id, v.producer, v.model, v.regnr, v.vin, v.odo, v.body, v.drivingside, v.engine,
        v.productiondate, v.region, v.series, v.transmission, v.description, v.introducedat,
        r.ownerid as ownerid,
        concat_ws(' ', p.firstname, p.lastname, l.name) as ownername
      FROM domain.vehicle v
        LEFT JOIN domain.vehicleregistration r ON r.vehicleid = v.id AND r.datetimeto IS NULL
        LEFT JOIN domain.privateclient p ON p.id = r.ownerid
        LEFT JOIN domain.legalclient  l ON l.id = r.ownerid
      WHERE v.id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;

    return {
      id: row.id,
      producer: row.producer,
      model: row.model,
      regNr: row.regnr,
      vin: row.vin,
      odo: row.odo === null ? null : Number(row.odo),
      body: row.body,
      drivingSide: row.drivingside,
      engine: row.engine,
      productionDate: iso(row.productiondate),
      region: row.region,
      series: row.series,
      transmission: row.transmission,
      ownerId: row.ownerid,
      ownerName: row.ownername,
      description: row.description,
      introducedAt: iso(row.introducedat),
    };
  }

  async findOrFail(id: string): Promise<VehicleRecord> {
    const vehicle = await this.find(id);
    if (!vehicle) throw new NotFoundError('Vehicle');
    return vehicle;
  }

  async create(input: {
    regNr: string;
    producer?: string | null | undefined;
    model?: string | null | undefined;
    vin?: string | null | undefined;
    odo?: number | null | undefined;
    body?: string | null | undefined;
    drivingSide?: string | null | undefined;
    engine?: string | null | undefined;
    productionDate?: string | null | undefined;
    region?: string | null | undefined;
    series?: string | null | undefined;
    transmission?: string | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
    ownerId?: string | null | undefined;
  }): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const id = randomUUID();
      await sql`
        INSERT INTO domain.vehicle
          (id, producer, model, regnr, vin, odo, body, drivingside, engine,
           productiondate, region, series, transmission, description, introducedat)
        VALUES (
          ${id}::uuid, ${input.producer ?? null}, ${input.model ?? null}, ${input.regNr},
          ${input.vin ?? null}, ${input.odo ?? null}, ${input.body ?? null},
          ${input.drivingSide ?? null}, ${input.engine ?? null}, ${input.productionDate ?? null},
          ${input.region ?? null}, ${input.series ?? null}, ${input.transmission ?? null},
          ${input.description ?? null}, ${input.introducedAt ?? new Date().toISOString()}
        )
      `.execute(tx);

      if (input.ownerId) {
        await startRegistration(tx, id, input.ownerId);
      }
      return id;
    });
  }

  /**
   * `VehiclesController.Edit`.
   *
   * The original skipped re-registration when the owner was unchanged and only
   * re-read the owner when `OwnerId` was supplied, calling `EndRegistration()`
   * when it was omitted.
   */
  async update(id: string, input: Parameters<VehicleRepository['create']>[0]): Promise<void> {
    await this.findOrFail(id);

    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE domain.vehicle SET
          producer = ${input.producer ?? null}, model = ${input.model ?? null},
          regnr = ${input.regNr}, vin = ${input.vin ?? null},
          odo = ${input.odo ?? null}, body = ${input.body ?? null},
          drivingside = ${input.drivingSide ?? null}, engine = ${input.engine ?? null},
          productiondate = ${input.productionDate ?? null}, region = ${input.region ?? null},
          series = ${input.series ?? null}, transmission = ${input.transmission ?? null},
          description = ${input.description ?? null}
        WHERE id = ${id}::uuid
      `.execute(tx);

      if (input.ownerId == null) {
        await endRegistration(tx, id);
        return;
      }

      const existing = await sql<{ ownerid: string | null }>`
        SELECT ownerid FROM domain.vehicleregistration
         WHERE vehicleid = ${id}::uuid AND datetimeto IS NULL
      `.execute(tx);

      // Unchanged owner means no new registration row; a different owner closes
      // the current one and opens a new one, exactly as `RegisterTo` did.
      if (existing.rows[0]?.ownerid === input.ownerId) return;
      await startRegistration(tx, id, input.ownerId);
    });
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db.transaction().execute(async (tx) => {
      for (const id of ids) {
        await sql`DELETE FROM domain.vehicleregistration WHERE vehicleid = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.vehicle WHERE id = ${id}::uuid`.execute(tx);
      }
    });
  }
}

interface VehicleRow {
  id: string;
  producer: string | null;
  model: string | null;
  regnr: string | null;
  vin: string | null;
  odo: number | string | null;
  body: string | null;
  drivingside: string | null;
  engine: string | null;
  productiondate: Date | string | null;
  region: string | null;
  series: string | null;
  transmission: string | null;
  description: string | null;
  introducedat: Date | string | null;
  ownerid: string | null;
  ownername: string | null;
}

async function startRegistration(
  tx: Kysely<Database>,
  vehicleId: string,
  ownerId: string,
): Promise<void> {
  const owner = await sql<{ id: string }>`
    SELECT c.id FROM domain.client c WHERE c.id = ${ownerId}::uuid
  `.execute(tx);
  if (!owner.rows[0]) throw new NotFoundError('Owner');

  await endRegistration(tx, vehicleId);

  await sql`
    INSERT INTO domain.vehicleregistration (ownerid, vehicleid, datetimefrom, datetimeto)
    VALUES (${ownerId}::uuid, ${vehicleId}::uuid, now(), null)
  `.execute(tx);
}

/** `Vehicle.EndRegistration` — stamps `datetimeto` on the effective row only. */
async function endRegistration(tx: Kysely<Database>, vehicleId: string): Promise<void> {
  await sql`
    UPDATE domain.vehicleregistration SET datetimeto = now()
     WHERE vehicleid = ${vehicleId}::uuid AND datetimeto IS NULL
  `.execute(tx);
}
