import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { NotFoundError } from '../core/errors.js';
import { requirePrincipal, requireRootPrincipal } from '../plugins/context.js';
import {
  errorResponseSchema,
  pageQuerySchema,
  standardResponses,
  validationErrorResponse,
} from '../schemas/common.js';
import type {
  addressSchema} from '../schemas/clients.js';
import {
  clientPageSchema,
  clientSchema,
  legalClientBodySchema,
  privateClientBodySchema,
} from '../schemas/clients.js';
import { clientHistorySchema } from '../schemas/history.js';
import { ClientRepository, type Address, type ClientRecord } from '../db/repositories/clients.js';
import { HistoryRepository } from '../db/repositories/history.js';
import { registerCrud } from './crud.js';

/**
 * Port of `ClientsController`, `PrivateClientsController` and `LegalClientsController`.
 *
 * Authorization follows the original attributes exactly, which are not uniform:
 *  - `/api/clients` had no class-level `[Authorize]`, so `GET /page` and the
 *    `GET /{id}` redirect were reachable with any valid token.
 *  - `/api/clients/{id}` was `[Authorize(Policy = "ServerSidePolicy")]` on the
 *    override and redirected to the subtype resource instead of returning a body.
 *  - `/api/privateclients` and `/api/legalclients` were `ServerSidePolicy` at the
 *    class level, so every action there — including POST — needed the Root role.
 */

function toAddress(address: z.infer<typeof addressSchema> | null | undefined): Address | null {
  if (!address) return null;
  return {
    street: address.street ?? null,
    country: address.country ?? null,
    region: address.region ?? null,
    city: address.city ?? null,
    postalCode: address.postalCode ?? null,
  };
}

/**
 * The .NET records always emitted every positional property, with `null` for the
 * ones that do not apply to the subtype. `present` keeps that shape.
 */
function present(record: ClientRecord) {
  return record;
}

export const clientRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ====================================================================== */
  /* /api/clients/page                                                      */
  /* ====================================================================== */
  app.get(
    '/clients/page',
    {
      schema: {
        tags: ['Clients'],
        summary: 'Search clients',
        querystring: pageQuerySchema,
        response: standardResponses(clientPageSchema, 'A page of clients'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new ClientRepository(request.tenantDb()).page(request.query);
    },
  );

  /* ====================================================================== */
  /* /api/clients/{id} — redirect to the subtype resource                   */
  /* ====================================================================== */
  app.get(
    '/clients/:id',
    {
      schema: {
        tags: ['Clients'],
        summary: 'Get a client',
        description:
          'Redirects to /api/privateclients/{id} or /api/legalclients/{id} depending on the client type, ' +
          'matching the legacy LocalRedirect behaviour.',
        params: z.object({ id: z.string().uuid() }),
        response: {
          302: z.null().describe('Redirect to the subtype resource; no body'),
          400: validationErrorResponse[400],
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
          404: errorResponseSchema.describe('Client not found'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      const subtype = await new ClientRepository(request.tenantDb()).subtypeOf(request.params.id);
      if (!subtype) throw new NotFoundError('Client');
      const resource = subtype === 'private' ? 'privateclients' : 'legalclients';
      return reply.redirect(`/api/${resource}/${request.params.id}`, 302);
    },
  );

  /* ====================================================================== */
  /* /api/clients/{id}/history                                              */
  /* ====================================================================== */
  app.get(
    '/clients/:id/history',
    {
      schema: {
        tags: ['Clients'],
        summary: 'Get the history of a client',
        description:
          'All work orders for the client chronologically, plus the vehicles currently registered to them.',
        params: z.object({ id: z.string().uuid() }),
        response: standardResponses(clientHistorySchema, 'The history of the client'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      const history = await new HistoryRepository(request.tenantDb()).clientHistory(
        request.params.id,
      );
      if (!history) throw new NotFoundError('Client');
      return history;
    },
  );

  /* ====================================================================== */
  /* /api/privateclients and /api/legalclients                              */
  /* ====================================================================== */
  registerCrud(app, {
    path: '/privateclients',
    tags: ['Clients'],
    label: 'a private client',
    bodySchema: privateClientBodySchema,
    recordSchema: clientSchema,
    requireRoot: {},

    handlers: {
      find: async (request, id) => present(await new ClientRepository(request.tenantDb()).findOrFail(id)),
      create: async (request, body) =>
        new ClientRepository(request.tenantDb()).createPrivate({
          firstName: body.firstName,
          lastName: body.lastName,
          personalCode: body.personalCode,
          address: toAddress(body.address),
          phone: body.phone,
          isAsshole: body.isAsshole,
          description: body.description,
          introducedAt: body.introducedAt,
          emailAddresses: body.emailAddresses,
          currentEmail: body.currentEmail,
        }),
      update: async (request, id, body) =>
        new ClientRepository(request.tenantDb()).updatePrivate(id, {
          firstName: body.firstName,
          lastName: body.lastName,
          personalCode: body.personalCode,
          address: toAddress(body.address),
          phone: body.phone,
          isAsshole: body.isAsshole,
          description: body.description,
          introducedAt: body.introducedAt,
          emailAddresses: body.emailAddresses,
          currentEmail: body.currentEmail,
        }),
      remove: async (request, ids) => new ClientRepository(request.tenantDb()).delete(ids),
    },
  });

  registerCrud(app, {
    path: '/legalclients',
    tags: ['Clients'],
    label: 'a legal client',
    bodySchema: legalClientBodySchema,
    recordSchema: clientSchema,
    requireRoot: {},

    handlers: {
      find: async (request, id) => present(await new ClientRepository(request.tenantDb()).findOrFail(id)),
      create: async (request, body) =>
        new ClientRepository(request.tenantDb()).createLegal({
          name: body.name,
          regNr: body.regNr,
          address: toAddress(body.address),
          phone: body.phone,
          isAsshole: body.isAsshole,
          description: body.description,
          introducedAt: body.introducedAt,
          emailAddresses: body.emailAddresses,
          currentEmail: body.currentEmail,
        }),
      update: async (request, id, body) =>
        new ClientRepository(request.tenantDb()).updateLegal(id, {
          name: body.name,
          regNr: body.regNr,
          address: toAddress(body.address),
          phone: body.phone,
          isAsshole: body.isAsshole,
          description: body.description,
          introducedAt: body.introducedAt,
          emailAddresses: body.emailAddresses,
          currentEmail: body.currentEmail,
        }),
      remove: async (request, ids) => new ClientRepository(request.tenantDb()).delete(ids),
    },
  });
};
