import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal } from '../plugins/context.js';
import { NotFoundError } from '../core/errors.js';
import { pageQuerySchema, standardResponses } from '../schemas/common.js';
import {
  clientVehicleSchema,
  vehicleBodySchema,
  vehiclePageSchema,
  vehicleSchema,
} from '../schemas/vehicles.js';
import { vehicleHistorySchema } from '../schemas/history.js';
import { VehicleRepository } from '../db/repositories/vehicles.js';
import { HistoryRepository } from '../db/repositories/history.js';
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

  app.get(
    '/vehicles/:id/history',
    {
      schema: {
        tags: ['Vehicles'],
        summary: 'Get the maintenance history of a vehicle',
        description:
          'All work orders on the vehicle chronologically, each with its offers, estimates and invoice.',
        params: z.object({ id: z.string().uuid() }),
        response: standardResponses(vehicleHistorySchema, 'The maintenance history of the vehicle'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      const history = await new HistoryRepository(request.tenantDb()).vehicleHistory(
        request.params.id,
      );
      if (!history) throw new NotFoundError('Vehicle');
      return history;
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
