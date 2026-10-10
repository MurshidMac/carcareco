import { z } from 'zod';
import { pagedResultSchema, uuidSchema } from './common.js';

/** `SparePartDto`. */
export const sparePartSchema = z
  .object({
    id: uuidSchema,
    code: z.string().nullable(),
    name: z.string().nullable(),
    price: z.coerce.number().nullish(),
    quantity: z.coerce.number().nullish(),
    discount: z.coerce.number().int().nullish(),
    storageId: uuidSchema.nullable(),
    storageName: z.string().nullable(),
    description: z.string().nullable(),
    introducedAt: z.string().nullable(),
  })
  .describe('A spare part');

/** Body of `POST /api/spareparts` and `PUT /api/spareparts/{id}`. */
export const sparePartBodySchema = z
  .object({
    id: uuidSchema.nullish(),
    code: z.string().min(1),
    name: z.string().min(1),
    price: z.coerce.number().default(0).describe('Accepts a number or a numeric string'),
    quantity: z.coerce.number().default(0).describe('Accepts a number or a numeric string'),
    discount: z.coerce.number().int().nullish(),
    storageId: uuidSchema.nullish(),
    description: z.string().nullish(),
    introducedAt: z.string().nullish(),
  })
  .describe('A spare part');

/** Row shape of `GET /api/spareparts/page` — a superset of `SparePartDto`. */
export const sparePartPageItemSchema = sparePartSchema.extend({
  storageName: z.string().nullable().describe('Name of the storage location, joined in'),
});

export const sparePartPageSchema = pagedResultSchema(
  sparePartPageItemSchema,
  'A page of spare parts',
);

/**
 * `UmPriceDto` — the price fetched from the United Motors catalogue.
 *
 * `PriceFromUm(decimal price, string name, string address)` took all three as
 * non-nullable, and `domain.unitedmotorsprice.name` is `NOT NULL`, so `name`
 * and `price` are required here.
 */
export const umPriceSchema = z
  .object({
    name: z.string().describe('Catalogue description'),
    price: z.coerce.number().describe('Catalogue price'),
    address: z.string().nullish().describe('Supplier address'),
  })
  .describe('A supplier catalogue price');

/** `StorageDto`. */
export const storageSchema = z
  .object({
    id: uuidSchema,
    name: z.string().nullable(),
    address: z.string().nullable(),
    description: z.string().nullable(),
    introducedAt: z.string().nullable(),
  })
  .describe('A storage location');

/** Body of `POST /api/storages` and `PUT /api/storages/{id}`. */
export const storageBodySchema = z
  .object({
    id: uuidSchema.nullish(),
    name: z.string().min(1),
    address: z.string().nullish(),
    description: z.string().nullish(),
    introducedAt: z.string().nullish(),
  })
  .describe('A storage location');

/** Minimal `{id, name}` projection returned by `GET /api/storages`. */
export const locationSchema = z
  .object({ id: uuidSchema, name: z.string().nullable() })
  .describe('A storage location');

export const storagePageSchema = pagedResultSchema(storageSchema, 'A page of storage locations');
