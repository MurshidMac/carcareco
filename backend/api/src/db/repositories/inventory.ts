import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { PageQuery, type PageResult } from '../../core/paging.js';
import { NotFoundError } from '../../core/errors.js';

/**
 * Port of `SparePartsController` and `StoragesController`.
 *
 * Both resources were single-table, so the statements here are plain SQL. The
 * one non-obvious behaviour is `PriceFromUm`: it keeps a supplier catalogue row
 * in `domain.unitedmotorsprice` and also overwrites the part's own price.
 */

export interface SparePart {
  id: string;
  code: string | null;
  name: string | null;
  price: number | null;
  quantity: number | null;
  discount: number | null;
  storageId: string | null;
  storageName: string | null;
  description: string | null;
  introducedAt: string | null;
}

export interface Storage {
  id: string;
  name: string | null;
  address: string | null;
  description: string | null;
  introducedAt: string | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function num(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

const SPARE_PART_PROJECTION = `
  select sparepart.id, sparepart.code, sparepart.name, sparepart.price,
         sparepart.quantity, sparepart.discount, sparepart.storageid,
         sparepart.description, sparepart.introducedat,
         s.name as storagename
    from domain.sparepart
    left join domain.storage s on s.id = sparepart.storageid
`;

export class SparePartRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `SparePartsController.GetPage`. */
  async page(params: {
    searchText?: string | undefined;
    orderby?: string | undefined;
    limit: number;
    offset: number;
    desc: boolean;
  }): Promise<PageResult<SparePart>> {
    const result = await new PageQuery(params, {
      allowedOrderBy: [
        'id',
        'code',
        'name',
        'price',
        'quantity',
        'discount',
        'storageid',
        'description',
        'introducedat',
        'storagename',
      ],
      defaultOrderBy: 'name',
    })
      .searchFields("concat_ws(' ',sparepart.code,sparepart.name,s.name)")
      .execute<SparePartRow>(this.db, SPARE_PART_PROJECTION);

    return {
      hasMore: result.hasMore,
      items: result.items.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        price: num(row.price),
        quantity: num(row.quantity),
        discount: row.discount,
        storageId: row.storageid,
        storageName: row.storagename,
        description: row.description,
        introducedAt: iso(row.introducedat),
      })),
    };
  }

  async find(id: string): Promise<SparePart | undefined> {
    const result = await sql<SparePartRow>`
      ${sql.raw(SPARE_PART_PROJECTION)}
      where sparepart.id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      price: num(row.price),
      quantity: num(row.quantity),
      discount: row.discount,
      storageId: row.storageid,
      storageName: row.storagename,
      description: row.description,
      introducedAt: iso(row.introducedat),
    };
  }

  async findOrFail(id: string): Promise<SparePart> {
    const part = await this.find(id);
    if (!part) throw new NotFoundError('Spare part');
    return part;
  }

  async create(input: {
    code: string;
    name: string;
    price?: number | null | undefined;
    quantity?: number | null | undefined;
    discount?: number | null | undefined;
    storageId?: string | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
  }): Promise<string> {
    const id = randomUUID();
    await sql`
      INSERT INTO domain.sparepart
        (id, code, name, price, storageid, quantity, discount, description, introducedat)
      VALUES (
        ${id}::uuid, ${input.code}, ${input.name}, ${input.price ?? null},
        ${input.storageId ?? null}::uuid, ${input.quantity ?? null}, ${input.discount ?? null},
        ${input.description ?? null}, ${input.introducedAt ?? new Date().toISOString()}
      )
    `.execute(this.db);
    return id;
  }

  async update(id: string, input: Parameters<SparePartRepository['create']>[0]): Promise<void> {
    await this.findOrFail(id);

    // `Edit` only moved the part when a storage was supplied, so a null keeps the
    // current location rather than clearing it.
    const storageId = input.storageId ? sql`${input.storageId}::uuid` : sql`storageid`;

    await sql`
      UPDATE domain.sparepart SET
        code = ${input.code}, name = ${input.name}, price = ${input.price ?? null},
        quantity = ${input.quantity ?? null}, discount = ${input.discount ?? null},
        description = ${input.description ?? null}, storageid = ${storageId}
      WHERE id = ${id}::uuid
    `.execute(this.db);
  }

  /**
   * `SparePartsController.FreshenUmPrice` — `PUT /api/spareparts/{id}/umprice`.
   *
   * The NHibernate mapping cascaded delete-orphan on `UmPrice`, so an existing
   * catalogue row was replaced rather than duplicated.
   */
  async setUmPrice(id: string, umPrice: { price: number; name: string; address: string }): Promise<void> {
    await this.findOrFail(id);

    await this.db.transaction().execute(async (tx) => {
      const existing = await sql<{ umpriceid: string | null }>`
        SELECT umpriceid FROM domain.sparepart WHERE id = ${id}::uuid
      `.execute(tx);

      const previous = existing.rows[0]?.umpriceid;
      let umPriceId = previous;

      if (previous) {
        await sql`
          UPDATE domain.unitedmotorsprice
             SET price = ${umPrice.price}, name = ${umPrice.name}, address = ${umPrice.address}
           WHERE id = ${previous}::uuid
        `.execute(tx);
      } else {
        umPriceId = randomUUID();
        await sql`
          INSERT INTO domain.unitedmotorsprice (id, price, name, address)
          VALUES (${umPriceId}::uuid, ${umPrice.price}, ${umPrice.name}, ${umPrice.address})
        `.execute(tx);
      }

      await sql`
        UPDATE domain.sparepart SET price = ${umPrice.price}, umpriceid = ${umPriceId}::uuid
         WHERE id = ${id}::uuid
      `.execute(tx);
    });
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db.transaction().execute(async (tx) => {
      for (const id of ids) {
        const part = await sql<{ umpriceid: string | null }>`
          SELECT umpriceid FROM domain.sparepart WHERE id = ${id}::uuid
        `.execute(tx);

        await sql`DELETE FROM domain.sparepart WHERE id = ${id}::uuid`.execute(tx);

        const umPriceId = part.rows[0]?.umpriceid;
        if (umPriceId) {
          await sql`DELETE FROM domain.unitedmotorsprice WHERE id = ${umPriceId}::uuid`.execute(tx);
        }
      }
    });
  }
}

interface SparePartRow {
  id: string;
  code: string | null;
  name: string | null;
  price: number | string | null;
  quantity: number | string | null;
  discount: number | null;
  storageid: string | null;
  description: string | null;
  introducedat: Date | string | null;
  storagename: string | null;
}

export class StorageRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `StoragesController.Get` — the id/name pairs used by dropdowns. */
  async list(): Promise<{ id: string; name: string | null }[]> {
    const result = await sql<{ id: string; name: string | null }>`
      select id, name from domain.storage order by name
    `.execute(this.db);
    return result.rows;
  }

  async page(params: {
    searchText?: string | undefined;
    orderby?: string | undefined;
    limit: number;
    offset: number;
    desc: boolean;
  }): Promise<PageResult<Storage>> {
    const result = await new PageQuery(params, {
      allowedOrderBy: ['id', 'name', 'address', 'description', 'introducedat'],
      defaultOrderBy: 'name',
    })
      .searchFields("concat_ws(' ',name,address,description)")
      .execute<StorageRow>(this.db, 'select * from domain.storage');

    return {
      hasMore: result.hasMore,
      items: result.items.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        introducedAt: iso(row.introducedat),
      })),
    };
  }

  async find(id: string): Promise<Storage | undefined> {
    const result = await sql<StorageRow>`
      select * from domain.storage where id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      description: row.description,
      introducedAt: iso(row.introducedat),
    };
  }

  async findOrFail(id: string): Promise<Storage> {
    const storage = await this.find(id);
    if (!storage) throw new NotFoundError('Storage');
    return storage;
  }

  async create(input: {
    name: string;
    address?: string | null | undefined;
    description?: string | null | undefined;
    introducedAt?: string | null | undefined;
  }): Promise<string> {
    const id = randomUUID();
    await sql`
      INSERT INTO domain.storage (id, name, address, description, introducedat)
      VALUES (
        ${id}::uuid, ${input.name}, ${input.address ?? null}, ${input.description ?? null},
        ${input.introducedAt ?? new Date().toISOString()}
      )
    `.execute(this.db);
    return id;
  }

  async update(id: string, input: Parameters<StorageRepository['create']>[0]): Promise<void> {
    await this.findOrFail(id);
    await sql`
      UPDATE domain.storage SET
        name = ${input.name}, address = ${input.address ?? null}, description = ${input.description ?? null}
      WHERE id = ${id}::uuid
    `.execute(this.db);
  }

  /**
   * `BaseController.Delete` on storages.
   *
   * `domain.sparepart.storageid` references the storage, so the raw delete the
   * NHibernate unit of work issued would have been rejected by the foreign key
   * whenever parts were still stored there. Parts are detached (`storageid` is
   * nullable) instead of being deleted, which is the only way the operation can
   * succeed without destroying inventory.
   */
  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db.transaction().execute(async (tx) => {
      for (const id of ids) {
        await sql`UPDATE domain.sparepart SET storageid = null WHERE storageid = ${id}::uuid`.execute(tx);
        await sql`DELETE FROM domain.storage WHERE id = ${id}::uuid`.execute(tx);
      }
    });
  }
}

interface StorageRow {
  id: string;
  name: string | null;
  address: string | null;
  description: string | null;
  introducedat: Date | string | null;
}
