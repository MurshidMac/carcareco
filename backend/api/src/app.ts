import type { FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { requestContextPlugin } from './plugins/context.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { docsPlugin, scalarPlugin } from './plugins/docs.js';
import { authRoutes } from './routes/auth.js';
import { systemRoutes } from './routes/system.js';
import { config } from './config/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = (await import('fastify')).default({
    logger: { level: config.logLevel },
  }) as unknown as FastifyInstance;

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(requestContextPlugin);
  await fastify.register(errorHandlerPlugin);

  // Register docs before business routes so `/docs/openapi.json` is stable.
  await fastify.register(docsPlugin);
  await fastify.register(scalarPlugin);

  // Core routes
  await fastify.register(authRoutes, { prefix: '/api' });
  await fastify.register(systemRoutes, { prefix: '/api' });

  // TODO: add remaining route groups (clients, vehicles, work, pricing, inventory, employees, settings).

  return fastify.withTypeProvider<ZodTypeProvider>();
}