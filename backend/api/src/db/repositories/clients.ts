import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { PageQuery, type PageResult } from '../../core/paging.js';
import { NotFoundError, UserError } from '../../core/errors.js';

/**
 * Port of `ClientsController`, `PrivateClientsController` and `LegalClientsController`.
 *
 * `domain.Client` is NHibernate table-per-subclass: the shared contact columns live
 * in `domain.client` and the subtype columns in `domain.privateclient` /
 * `domain.legalclient`, keyed by the same id. Because the two halves are written
 * separately there is no single-table insert, so the statements here are raw SQL
 * inside one transaction.
 */

export interface Address {
  country: string | null;
  region: string | null;
  city: string | null;
  street: string | null;
  postalCode: string | null;
}

export interface ClientRecord {
  id: string;
  address: Address | null;
  phone: string | null;
  emailAddresses: string[] | null;
  currentEmail: string | null;
  isAsshole: boolean | null;
  description: string | null;
  introducedAt: string | null;
  isPrivate: boolean;
  name: string | null;
  regNr: string | null;
  firstName: string | null;
  lastName: string | null;
  personalCode: string | null;
}

export interface ClientPageItem {
  id: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  introducedAt: string | null;
  isCompany: boolean | null;
}

/** `ClientPageItem` in its raw database column shape. */
interface ClientPageRow {
  id: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  introducedat: Date | string | null;
  iscompany: boolean | null;
}

/** The active email, which the list query joins directly. */
const PAGE_PROJECTION = `
  SELECT
    c.id,
    concat_ws(' ',c.country,c.region,c.city,c.address,c.postalcode) as address,
    ce.address AS email,
    c.introducedat,
    (l.id IS NOT NULL) AS iscompany,
    concat_ws(' ',firstname,lastname,l.name) as name,
    c.phone
  FROM domain.client AS c
    left join domain.clientemail ce on ce.clientid = c.id and ce.isactive
    LEFT JOIN domain.legalclient AS l ON c.id = l.id
    LEFT JOIN domain.privateclient AS p ON c.id = p.id
`;

const CLIENT_SEARCH_FIELDS = "concat_ws(' ',firstname,lastname,l.name,ce.address,c.phone,c.address)";

export class ClientRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `ClientsController.GetPage`. */
  async page(params: {
    searchText?: string | undefined;
    orderby?: string | undefined;
    limit: number;
    offset: number;
    desc: boolean;
  }): Promise<PageResult<ClientPageItem>> {
    const result = await new PageQuery(params, {
      allowedOrderBy: ['id', 'name', 'address', 'phone', 'email', 'introducedat', 'iscompany'],
      defaultOrderBy: 'introducedat',
    })
      .searchFields(CLIENT_SEARCH_FIELDS)
      .execute<ClientPageRow>(this.db, PAGE_PROJECTION);

    return {
      hasMore: result.hasMore,
      items: result.items.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        introducedAt:
          row.introducedat instanceof Date ? row.introducedat.toISOString() : row.introducedat,
        isCompany: row.iscompany,
      })),
    };
  }

  /** Loads the full record for either subtype, or `undefined` when unknown. */
  async find(id: string): Promise<ClientRecord | undefined> {
    const result = await sql<ClientRecordRow>`
      SELECT
        c.id,
        c.address, c.country, c.region, c.city, c.postalcode,
        c.phone, c.description, c.isasshole, c.introducedat,
        p.firstname, p.lastname, p.personalcode,
        l.name, l.regnr,
        (p.id IS NOT NULL) AS isprivate
      FROM domain.client c
        LEFT JOIN domain.privateclient p ON p.id = c.id
        LEFT JOIN domain.legalclient  l ON l.id = c.id
      WHERE c.id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;

    const emails = await sql<{ address: string; isactive: boolean }>`
      SELECT address, isactive FROM domain.clientemail
       WHERE clientid = ${id}::uuid
       ORDER BY address
    `.execute(this.db);

    return {
      id: row.id,
      address: {
        street: row.address,
        country: row.country,
        region: row.region,
        city: row.city,
        postalCode: row.postalcode,
      },
      phone: row.phone,
      emailAddresses: emails.rows.map((e) => e.address),
      currentEmail: emails.rows.find((e) => e.isactive)?.address ?? null,
      isAsshole: row.isasshole,
      description: row.description,
      introducedAt: row.introducedat instanceof Date ? row.introducedat.toISOString() : row.introducedat,
      isPrivate: row.isprivate,
      firstName: row.firstname,
      lastName: row.lastname,
      personalCode: row.personalcode,
      name: row.name,
      regNr: row.regnr,
    };
  }

  async findOrFail(id: string): Promise<ClientRecord> {
    const client = await this.find(id);
    if (!client) throw new NotFoundError('Client not found.');
    return client;
  }

  /**
   * `ClientsController.Get(Guid)` redirected to the subtype resource instead of
   * returning a body, so the caller decides which route to answer with.
   */
  async subtypeOf(id: string): Promise<'private' | 'legal' | undefined> {
    const client = await this.find(id);
    if (!client) return undefined;
    return client.isPrivate ? 'private' : 'legal';
  }

  /** Fields shared by both subtypes; `introducedAt` defaults to now as in .NET. */
  private contactFields(input: {
    address?: Address | null | undefined;
    phone?: string | null | undefined;
    isAsshole?: boolean | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
  }): Record<string, unknown> {
    return {
      address: input.address?.street ?? null,
      country: input.address?.country ?? null,
      region: input.address?.region ?? null,
      city: input.address?.city ?? null,
      postalcode: input.address?.postalCode ?? null,
      phone: input.phone ?? null,
      isasshole: input.isAsshole ?? false,
      description: input.description ?? null,
      introducedat: input.introducedAt ?? new Date().toISOString(),
    };
  }

  async createPrivate(input: {
    firstName: string;
    lastName?: string | null | undefined;
    personalCode?: string | null | undefined;
    address?: Address | null | undefined;
    phone?: string | null | undefined;
    isAsshole?: boolean | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
    emailAddresses?: string[] | null | undefined;
    currentEmail?: string | null | undefined;
  }): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const id = randomUUID();
      const contact = this.contactFields(input);
      await sql`
        INSERT INTO domain.client
          (id, address, country, region, city, postalcode, phone, description, isasshole, introducedat)
        VALUES (
          ${id}::uuid, ${contact.address}, ${contact.country}, ${contact.region}, ${contact.city},
          ${contact.postalcode}, ${contact.phone}, ${contact.description},
          ${contact.isasshole}, ${contact.introducedat}
        )
      `.execute(tx);

      await sql`
        INSERT INTO domain.privateclient (id, firstname, lastname, personalcode)
        VALUES (${id}::uuid, ${input.firstName}, ${input.lastName ?? null}, ${input.personalCode ?? null})
      `.execute(tx);

      await replaceEmails(tx, id, input.emailAddresses, input.currentEmail);
      return id;
    });
  }

  async createLegal(input: {
    name: string;
    regNr?: string | null | undefined;
    address?: Address | null | undefined;
    phone?: string | null | undefined;
    isAsshole?: boolean | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
    emailAddresses?: string[] | null | undefined;
    currentEmail?: string | null | undefined;
  }): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const id = randomUUID();
      const contact = this.contactFields(input);
      await sql`
        INSERT INTO domain.client
          (id, address, country, region, city, postalcode, phone, description, isasshole, introducedat)
        VALUES (
          ${id}::uuid, ${contact.address}, ${contact.country}, ${contact.region}, ${contact.city},
          ${contact.postalcode}, ${contact.phone}, ${contact.description},
          ${contact.isasshole}, ${contact.introducedat}
        )
      `.execute(tx);

      await sql`
        INSERT INTO domain.legalclient (id, name, regnr)
        VALUES (${id}::uuid, ${input.name}, ${input.regNr ?? null})
      `.execute(tx);

      await replaceEmails(tx, id, input.emailAddresses, input.currentEmail);
      return id;
    });
  }

  async updatePrivate(id: string, input: Parameters<ClientRepository['createPrivate']>[0]): Promise<void> {
    await this.update(id, input, 'private');
  }

  async updateLegal(id: string, input: Parameters<ClientRepository['createLegal']>[0]): Promise<void> {
    await this.update(id, input, 'legal');
  }

  private async update(
    id: string,
    input: {
      address?: Address | null | undefined;
      phone?: string | null | undefined;
      isAsshole?: boolean | null | undefined;
      description?: string | null | undefined;
      introducedAt?: string | null | undefined;
      emailAddresses?: string[] | null | undefined;
      currentEmail?: string | null | undefined;
    } & Record<string, unknown>,
    subtype: 'private' | 'legal',
  ): Promise<void> {
    const existing = await this.findOrFail(id);
    if ((existing.isPrivate ? 'private' : 'legal') !== subtype) {
      throw new UserError('The record is not of the expected client type.');
    }

    await this.db.transaction().execute(async (tx) => {
      const contact = this.contactFields(input);
      await sql`
        UPDATE domain.client SET
          address = ${contact.address}, country = ${contact.country}, region = ${contact.region},
          city = ${contact.city}, postalcode = ${contact.postalcode}, phone = ${contact.phone},
          description = ${contact.description}, isasshole = ${contact.isasshole}
        WHERE id = ${id}::uuid
      `.execute(tx);

      if (subtype === 'private') {
        await sql`
          UPDATE domain.privateclient
             SET firstname = ${input.firstName}, lastname = ${input.lastName ?? null},
                 personalcode = ${input.personalCode ?? null}
           WHERE id = ${id}::uuid
        `.execute(tx);
      } else {
        await sql`
          UPDATE domain.legalclient SET name = ${input.name}, regnr = ${input.regNr ?? null}
           WHERE id = ${id}::uuid
        `.execute(tx);
      }

      await replaceEmails(tx, id, input.emailAddresses, input.currentEmail);
    });
  }

  /**
   * `BaseController.Delete` deletes one record per id in the request body.
   * Subtype rows and emails are removed first; the schema has no foreign keys,
   * so an explicit order is all that is required.
   */
  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db.transaction().execute(async (tx) => {
      for (const id of ids) {
        await sql`DELETE FROM domain.clientemail WHERE clientid = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.privateclient WHERE id = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.legalclient WHERE id = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.client WHERE id = ${id}::uuid`.execute(tx);
      }
    });
  }
}

interface ClientRecordRow {
  id: string;
  address: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postalcode: string | null;
  phone: string | null;
  description: string | null;
  isasshole: boolean | null;
  introducedat: Date | string | null;
  firstname: string | null;
  lastname: string | null;
  personalcode: string | null;
  name: string | null;
  regnr: string | null;
  isprivate: boolean;
}

/**
 * `Client.UsesEmail(addresses, activeAddress)`.
 *
 * The .NET original returned early for an empty list, removed addresses that were
 * no longer listed, appended the missing ones as inactive, and finally activated
 * exactly one. `ChangeCurrentEmail` used `Single`, so an active address outside the
 * supplied list threw; that is preserved here as a user error rather than a 500.
 */
export async function replaceEmails(
  tx: Kysely<Database>,
  clientId: string,
  addresses: readonly string[] | null | undefined,
  activeAddress: string | null | undefined,
): Promise<void> {
  if (!addresses || addresses.length === 0) return;

  const unique = [...new Set(addresses)];

  const current = await sql<{ address: string; isactive: boolean }>`
    SELECT address, isactive FROM domain.clientemail WHERE clientid = ${clientId}::uuid
  `.execute(tx);

  for (const row of current.rows) {
    if (!unique.includes(row.address)) {
      await sql`DELETE FROM domain.clientemail WHERE clientid = ${clientId}::uuid AND address = ${row.address}`.execute(
        tx,
      );
    }
  }

  const existing = new Set(current.rows.map((r) => r.address));
  for (const address of unique) {
    if (!existing.has(address)) {
      await sql`
        INSERT INTO domain.clientemail (address, clientid, isactive) VALUES (${address}, ${clientId}::uuid, false)
      `.execute(tx);
    }
  }

  if (activeAddress != null) {
    if (!unique.includes(activeAddress)) {
      throw new UserError('The active email address must be one of the supplied addresses.');
    }
    await sql`
      UPDATE domain.clientemail SET isactive = (address = ${activeAddress})
       WHERE clientid = ${clientId}::uuid
    `.execute(tx);
  }

  // `UsesEmail` asserted that at most one address stays active; keep that guard.
  const activeCount = await sql<{ count: number | string }>`
    SELECT count(*) as count FROM domain.clientemail WHERE clientid = ${clientId}::uuid AND isactive
  `.execute(tx);
  if (Number(activeCount.rows[0]?.count ?? 0) > 1) {
    throw new UserError('only 1 active email allowed');
  }
}
