import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { limits } from '../core/rate-limit.js';
import { requireRootPrincipal } from '../plugins/context.js';
import { errorResponseSchema } from '../schemas/common.js';
import { appOptionsSchema } from '../schemas/settings.js';
import { TenantConfigRepository } from '../db/repositories/tenant-config.js';
import { dumpDatabase, dumpFileName } from '../core/backup.js';
import { config } from '../config/index.js';
import { z } from 'zod';

/**
 * Port of `OptionsController`.
 *
 * Both actions were `ServerSidePolicy`. The original returned a bare
 * `StatusCode(500, "Failed to retrieve configuration")` string on failure
 * rather than the shared error envelope; the envelope is used here so the
 * frontend's `exceptionMessage` handling works uniformly.
 */
export const optionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/options',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Get tenant configuration',
        description: 'Company requisites plus invoice and estimate defaults.',
        response: {
          200: appOptionsSchema,
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
          500: errorResponseSchema.describe('The configuration could not be read'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new TenantConfigRepository(request.tenantDb()).getAppOptions();
    },
  );

  /**
   * `[HttpPut]` on the controller — note the original named the action `Post`
   * but mapped it to PUT, and the frontend issues `PUT /api/options`.
   */
  app.put(
    '/options',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Save tenant configuration',
        body: appOptionsSchema,
        response: {
          200: z.null().describe('Acknowledged; empty body'),
          400: errorResponseSchema.describe('The request body failed validation'),
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
          500: errorResponseSchema.describe('The configuration could not be saved'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new TenantConfigRepository(request.tenantDb()).saveAppOptions(request.body);
      return reply.code(200).send(null);
    },
  );

  /**
   * `OptionsController.DumpDb` — streamed back as a file download.
   *
   * The original dumped the *primary* database (`DbOptions.Name`), not the
   * tenant's, and returned `application/octet-stream`; both are preserved.
   */
  app.get(
    '/options/dbdump',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Download a database dump',
        description: 'Runs `pg_dump` against the primary database and returns the SQL as a file.',
        response: {
          // The binary payload is described with a content-type scoped schema so
          // the serializer compiler leaves it untouched, matching the profile
          // picture route. The shape is documented on the route instead.
          200: {
            description: 'The plain-SQL dump, as a file download',
            content: { 'application/octet-stream': { schema: z.instanceof(Buffer) } },
          },
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
          500: errorResponseSchema.describe('The dump failed'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      const script = await dumpDatabase(config.db.name);

      reply.header('content-disposition', `inline;filename=${dumpFileName()}`);
      return reply.type('application/octet-stream').send(Buffer.from(script, 'utf8'));
    },
  );
};
