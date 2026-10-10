import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { requestContextPlugin } from './plugins/context.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { docsPlugin, scalarPlugin } from './plugins/docs.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { employeeRoutes } from './routes/employees.js';
import { inventoryRoutes } from './routes/inventory.js';
import { optionRoutes } from './routes/options.js';
import { pricingRoutes } from './routes/pricings.js';
import { systemRoutes } from './routes/system.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { workRoutes } from './routes/work.js';
import { config } from './config/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = (await import('fastify')).default({
    logger: { level: config.logLevel },
    // ASP.NET routing was case-insensitive; the frontend calls `/api/Demo/setup`.
    caseSensitive: false,
  }) as unknown as FastifyInstance;

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Mirrors the .NET CORS policy: `open` allows any origin, `restricted` only
  // the configured app host.
  await fastify.register(cors, {
    origin: config.cors.mode === 'open' ? true : config.cors.appHost,
    credentials: true,
  });

  await fastify.register(requestContextPlugin);
  await fastify.register(errorHandlerPlugin);

  // Register docs before business routes so `/docs/openapi.json` is stable.
  await fastify.register(docsPlugin);
  await fastify.register(scalarPlugin);

  // Core routes
  await fastify.register(authRoutes, { prefix: '/api' });
  await fastify.register(clientRoutes, { prefix: '/api' });
  await fastify.register(employeeRoutes, { prefix: '/api' });
  await fastify.register(inventoryRoutes, { prefix: '/api' });
  await fastify.register(vehicleRoutes, { prefix: '/api' });
  await fastify.register(optionRoutes, { prefix: '/api' });
  await fastify.register(systemRoutes, { prefix: '/api' });
  await fastify.register(dashboardRoutes, { prefix: '/api' });

  // Work orders and pricing
  await fastify.register(workRoutes, { prefix: '/api' });
  await fastify.register(pricingRoutes, { prefix: '/api' });

  return fastify.withTypeProvider<ZodTypeProvider>();
}