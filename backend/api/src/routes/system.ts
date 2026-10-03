import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal } from '../plugins/context.js';
import { pagedResultSchema, standardResponses } from '../schemas/common.js';
import { z } from 'zod';

/**
 * System endpoints: `GET /api/global/search`, `GET /api/healthz`, etc., that
 * don't belong to a specific aggregate but are called by the frontend.
 */

const globalSearchItemSchema = z.object({
  id: z.string(),
  table: z.string(),
  name: z.string(),
  extra: z.string().nullable(),
  fullSearchText: z.string().nullable(),
});

const globalSearchSchema = z.object({
  query: z.string().min(1),
});

export const systemRoutes: FastifyPluginCallback = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.get('/healthz', { schema: { hide: true } }, (_request, reply) => {
    reply.send({ status: 'ok' });
  });

  app.post(
    '/global/search',
    {
      schema: {
        tags: ['System'],
        summary: 'Global search',
        description: 'Performs a full-text search across tenants when multi-tenancy is on.',
        body: globalSearchSchema,
        response: standardResponses(pagedResultSchema(globalSearchItemSchema, 'Global search results'), 'Global search results'),
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requirePrincipal(request);
      // TODO: port the actual search query from the .NET implementation. For
      // now return an empty page to keep the contract intact.
      return reply.send({ hasMore: false, items: [] });
    },
  );

  // `/api/demo/setup` lives in auth routes; include `/api/options/app` placeholder
  // if needed via options routes later.
};
