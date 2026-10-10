import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal, requireRootPrincipal } from '../plugins/context.js';
import { errorResponseSchema, pageQuerySchema, standardResponses } from '../schemas/common.js';
import {
  locationSchema,
  sparePartBodySchema,
  sparePartPageSchema,
  sparePartSchema,
  storageBodySchema,
  storagePageSchema,
  storageSchema,
  umPriceSchema,
} from '../schemas/inventory.js';
import { SparePartRepository, StorageRepository } from '../db/repositories/inventory.js';
import { registerCrud } from './crud.js';

/**
 * Port of `SparePartsController` and `StoragesController`.
 *
 * Authorization was asymmetric:
 *  - `StoragesController` was `ServerSidePolicy` on the class, so everything —
 *    including the `GET /storages` id/name list — needed the Root role.
 *  - `SparePartsController` had no class-level attribute, so reads and POST were
 *    open and only `PUT /{id}/umprice`, `PUT /{id}` and `DELETE` were gated.
 */
export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ====================================================================== */
  /* Storages                                                               */
  /* ====================================================================== */

  /** The `GET /api/storages` id/name list, which replaced the inherited `GET /{id}`. */
  app.get(
    '/storages',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'List storage locations',
        description: 'Returns the id and name of every storage location, for dropdowns.',
        response: standardResponses(locationSchema, 'Storage locations'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new StorageRepository(request.tenantDb()).list();
    },
  );

  app.get(
    '/storages/page',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'Search storage locations',
        querystring: pageQuerySchema,
        response: standardResponses(storagePageSchema, 'A page of storage locations'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new StorageRepository(request.tenantDb()).page(request.query);
    },
  );

  registerCrud(app, {
    path: '/storages',
    tags: ['Inventory'],
    label: 'a storage location',
    bodySchema: storageBodySchema,
    recordSchema: storageSchema,
    requireRoot: {},
    handlers: {
      find: async (request, id) => new StorageRepository(request.tenantDb()).findOrFail(id),
      create: async (request, body) => new StorageRepository(request.tenantDb()).create(body),
      update: async (request, id, body) => new StorageRepository(request.tenantDb()).update(id, body),
      remove: async (request, ids) => new StorageRepository(request.tenantDb()).delete(ids),
    },
  });

  /* ====================================================================== */
  /* Spare parts                                                            */
  /* ====================================================================== */

  app.get(
    '/spareparts/page',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'Search spare parts',
        querystring: pageQuerySchema,
        response: standardResponses(sparePartPageSchema, 'A page of spare parts'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new SparePartRepository(request.tenantDb()).page(request.query);
    },
  );

  registerCrud(app, {
    path: '/spareparts',
    tags: ['Inventory'],
    label: 'a spare part',
    bodySchema: sparePartBodySchema,
    recordSchema: sparePartSchema,
    requireRoot: { find: false, create: false },
    handlers: {
      find: async (request, id) => new SparePartRepository(request.tenantDb()).findOrFail(id),
      create: async (request, body) => new SparePartRepository(request.tenantDb()).create(body),
      update: async (request, id, body) => new SparePartRepository(request.tenantDb()).update(id, body),
      remove: async (request, ids) => new SparePartRepository(request.tenantDb()).delete(ids),
    },
  });

  /**
   * `SparePartsController.FreshenUmPrice`. The legacy action declared the route as
   * `[HttpPut("/api/spareparts/{id}/umprice")]` with a leading slash, so the path
   * is absolute rather than relative to the controller prefix.
   *
   * It returned `void`, which ASP.NET rendered as an empty 200.
   */
  app.put(
    '/spareparts/:id/umprice',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'Refresh a spare part price from the supplier catalogue',
        description:
          'Stores the United Motors catalogue price and overwrites the part price with it.',
        params: z.object({ id: z.string().uuid() }),
        body: umPriceSchema,
        response: {
          200: z.null().describe('Acknowledged; empty body'),
          400: errorResponseSchema.describe('The request body failed validation'),
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
          404: errorResponseSchema.describe('Spare part not found'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      const { price, name, address } = request.body;
      await new SparePartRepository(request.tenantDb()).setUmPrice(request.params.id, {
        price,
        name,
        address: address ?? '',
      });
      return reply.code(200).send(null);
    },
  );
};
