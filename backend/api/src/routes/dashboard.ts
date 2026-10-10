import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal } from '../plugins/context.js';
import { standardResponses } from '../schemas/common.js';
import { dashboardSchema } from '../schemas/history.js';
import { DashboardRepository } from '../db/repositories/dashboard.js';

/**
 * `GET /api/dashboard` — the home screen.
 *
 * Additive: there is no legacy controller. It summarises the whole shop in one
 * round trip so the dashboard needs no client-side aggregation.
 */
export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/dashboard',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Get the dashboard summary',
        description: 'Row counts across the shop and the most recently started work orders.',
        response: standardResponses(dashboardSchema, 'The dashboard summary'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return new DashboardRepository(request.tenantDb()).summary();
    },
  );
};