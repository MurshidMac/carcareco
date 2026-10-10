import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal } from '../plugins/context.js';
import { pageQuerySchema, standardResponses } from '../schemas/common.js';
import {
  clientVehicleSchema,
  vehicleBodySchema,
  vehiclePageSchema,
  vehicleSchema,
} from '../schemas/vehicles.js';
import { VehicleRepository } from '../db/repositories/vehicles.js';
import { registerCrud } from './crud.js';

/**
 * Port of `VehiclesController`.
 *
 * `GET /page`, `GET /{id}`, `GET /client/{clientId}` and `POST` were reachable
 * with any valid token; only `PUT` and `DELETE` required the Root role. The CRUD
 * helper registers all four with one guard, so the shared ones are declared
 * separately here and the helper covers POST/PUT/DELETE.
 */
export const vehicleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/vehicles/page',
    {
      schema: {
        tags: ['Vehicles'],
        summary: 'Search vehicles',
        querystring: pageQuerySchema,
        response: standardResponses(vehiclePageSchema, 'A page of vehicles'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new VehicleRepository(request.tenantDb()).page(request.query);
    },
  );

  app.get(
    '/vehicles/client/:clientId',
    {
      schema: {
        tags: ['Vehicles'],
        summary: 'List the vehicles of a client',
        params: z.object({ clientId: z.string().uuid() }),
        response: standardResponses(clientVehicleSchema, 'Vehicles currently registered to the client'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new VehicleRepository(request.tenantDb()).forClient(request.params.clientId);
    },
  );

  registerCrud(app, {
    path: '/vehicles',
    tags: ['Vehicles'],
    label: 'a vehicle',
    bodySchema: vehicleBodySchema,
    recordSchema: vehicleSchema,
    // Reads and POST were open in the original; only PUT/DELETE needed the Root role.
    requireRoot: { find: false, create: false },
    handlers: {
      find: async (request, id) => new VehicleRepository(request.tenantDb()).findOrFail(id),
      create: async (request, body) => new VehicleRepository(request.tenantDb()).create(body),
      update: async (request, id, body) => new VehicleRepository(request.tenantDb()).update(id, body),
      remove: async (request, ids) => new VehicleRepository(request.tenantDb()).delete(ids),
    },
  });
};
