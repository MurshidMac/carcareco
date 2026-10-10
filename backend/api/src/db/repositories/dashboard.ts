import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/**
 * Home dashboard aggregation for `GET /api/dashboard`.
 *
 * Additive — there is no legacy controller for it. Counts are scalar
 * subselects so a single round trip feeds the stat cards, and the recent work
 * list reuses the same client/mechanic joins as the work-order pages.
 */

interface CountRow {
  work: number | string;
  openwork: number | string;
  clients: number | string;
  vehicles: number | string;
  spareparts: number | string;
  storages: number | string;
}

interface RecentWorkRow {
  id: string;
  worknr: number;
  startedon: Date;
  userstatus: string;
  invoiceid: string | null;
  notes: string | null;
  odo: number | null;
  clientname: string | null;
  regnr: string | null;
  mechanicnames: string | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function count(value: number | string): number {
  return Number(value);
}

export interface Dashboard {
  counts: {
    work: number;
    openWork: number;
    clients: number;
    vehicles: number;
    spareParts: number;
    storages: number;
  };
  recentWork: {
    id: string;
    workNr: string;
    startedOn: string;
    status: string;
    clientName: string | null;
    regNr: string | null;
    mechanicNames: string | null;
    notes: string | null;
    odo: number | null;
  }[];
}

export class DashboardRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async summary(): Promise<Dashboard> {
    const [counts, recent] = await Promise.all([
      this.counts(),
      this.recentWork(),
    ]);
    return { counts, recentWork: recent };
  }

  private async counts(): Promise<Dashboard['counts']> {
    const result = await sql<CountRow>`
      select
        (select count(*) from domain.work) as work,
        (select count(*) from domain.work where invoiceid is null) as openwork,
        (select count(*) from domain.client) as clients,
        (select count(*) from domain.vehicle) as vehicles,
        (select count(*) from domain.sparepart) as spareparts,
        (select count(*) from domain.storage) as storages
    `.execute(this.db);

    const row = result.rows[0];
    return {
      work: count(row?.work ?? 0),
      openWork: count(row?.openwork ?? 0),
      clients: count(row?.clients ?? 0),
      vehicles: count(row?.vehicles ?? 0),
      spareParts: count(row?.spareparts ?? 0),
      storages: count(row?.storages ?? 0),
    };
  }

  private async recentWork(): Promise<Dashboard['recentWork']> {
    const result = await sql<RecentWorkRow>`
      select w.id, w.number as worknr, w.startedon, w.userstatus, w.invoiceid,
             w.notes, w.odo, v.regnr,
             concat_ws(' ', pp.firstname, pp.lastname, ll.name) as clientname,
             (select string_agg(concat_ws(' ', m.firstname, m.lastname), '/ ')
                from domain.assignment a
                inner join domain.employee m on m.id = a.mechanicid
               where a.workid = w.id) as mechanicnames
        from domain.work w
        left join domain.vehicle v on v.id = w.vehicleid
        left join domain.legalclient ll on ll.id = w.clientid
        left join domain.privateclient pp on pp.id = w.clientid
       order by w.startedon desc
       limit 6
    `.execute(this.db);

    return result.rows.map((row) => ({
      id: row.id,
      workNr: String(row.worknr),
      startedOn: iso(row.startedon) ?? '',
      status: row.invoiceid != null ? 'completed' : row.userstatus.toLowerCase(),
      clientName: row.clientname,
      regNr: row.regnr,
      mechanicNames: row.mechanicnames,
      notes: row.notes,
      odo: row.odo,
    }));
  }
}