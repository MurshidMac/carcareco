import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal } from '../plugins/context.js';
import { standardResponses, uuidSchema } from '../schemas/common.js';
import { z } from 'zod';

/**
 * Cross-cutting endpoints: health probe and the cross-domain quick search
 * (`QueryController`).
 */

const queryResultSchema = z.object({
  id: uuidSchema,
  resourcename: z.string(),
  name: z.string().nullable(),
  controller: z.string(),
});

const queryResultsSchema = z.array(queryResultSchema);

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/healthz', { schema: { hide: true } }, (_request, reply) => {
    reply.send({ status: 'ok' });
  });

  app.get(
    '/query/:searchText',
    {
      schema: {
        tags: ['System'],
        summary: 'Quick search across all resources',
        description:
          'Searches clients, vehicles, work orders, invoices, estimates, spare parts and employees. ' +
          'Returns at most 10 matches, each tagged with the frontend route that should open it.',
        params: z.object({
          searchText: z.string().describe('Free text; blank returns an empty list'),
        }),
        response: standardResponses(queryResultsSchema, 'Matching resources'),
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requirePrincipal(request);
      const { searchText } = request.params;

      if (!searchText.trim()) return reply.send([]);

      const tokens = searchText
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0);
      if (tokens.length === 0) return reply.send([]);

      // The original matched with `to_tsvector(name) @@ to_tsquery(...)`, which
      // only hit whole lexemes and returned nothing for a partial word — a bad
      // fit for an as-you-type quick search. Every token is matched as a
      // substring instead; ordering and the limit of 10 are unchanged.
      const result = await sql<{
        id: string;
        resourcename: string;
        name: string | null;
        controller: string;
      }>`
        select * from (
          select id, 'Client' as resourcename,
                 concat_ws(' ', firstname, lastname) as name, 'klient' as controller
            from domain.privateclient
          union all
          select id, 'Client' as resourcename,
                 concat_ws(' ', name,
                   (case when regnr is null or regnr = '' then null else '(' || regnr || ')' end)) as name,
                 'klient' as controller
            from domain.legalclient
          union all
          select id, 'Vehicle' as resourcename,
                 concat_ws(' ', regnr,
                   (case when vin is null or vin = '' then null else '(' || vin || ')' end)) as name,
                 'soiduk' as controller
            from domain.vehicle
          union all
          select id, 'Work nr. ' as resourcename, '' || id as name, 'too' as controller
            from domain.work
          union all
          select work.id, 'Invoice nr. ' as resourcename, '' || invoice.number as name, 'too' as controller
            from domain.invoice inner join domain.work on work.invoiceid = invoice.id
          union all
          select work.id, 'Estimate nr. ' as resourcename, '' || offer.id as name, 'too' as controller
            from domain.offer inner join domain.work on work.id = offer.workid
          union all
          select id, 'Sparepart' as resourcename, code as name, 'varuosa' as controller
            from domain.sparepart
          union all
          select id, 'Employer' as resourcename, concat_ws(' ', firstname, lastname) as name, 'tootaja' as controller
            from domain.employee
        ) results
        where ${sql.join(
          tokens.map((token) => sql`name ilike ${`%${token}%`}`),
          sql` and `,
        )}
        limit 10
      `.execute(request.tenantDb());

      return reply.send(result.rows);
    },
  );
};
