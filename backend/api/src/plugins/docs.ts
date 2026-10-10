import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config/index.js';

export const BEARER_SECURITY = [{ bearerAuth: [] }] as const;

/**
 * Serves the generated OpenAPI 3.1 document and mounts the Scalar API
 * reference. Replaces the .NET `UseSwagger` + `UseSwaggerUI` pair.
 *
 * Route Zod schemas are the single source of truth: the same objects drive
 * request validation, response serialization and the published spec, so the
 * documentation cannot drift from behaviour.
 */
async function registerDocs(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'CarCare Co. API',
        version: '1.0.0',
        description: 'Repair-shop management API for CarCare Co.',
        license: { name: 'SEE LICENSE IN LICENSE' },
      },
      servers: [{ url: '/', description: 'This server' }],
      tags: [
        { name: 'Auth', description: 'Login, tokens and the signed-in profile' },
        { name: 'Clients', description: 'Private and legal clients' },
        { name: 'Vehicles', description: 'Vehicles and their registrations' },
        { name: 'Work', description: 'Repair jobs, offers, estimates and invoices' },
        { name: 'Pricings', description: 'Render invoices and estimates as PDF or HTML' },
        { name: 'Inventory', description: 'Spare parts and storage locations' },
        { name: 'Employees', description: 'Mechanics and administrators' },
        { name: 'Settings', description: 'Tenant configuration and database export' },
        { name: 'System', description: 'Health, search and demo provisioning' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT issued by `POST /api/users/authenticate`.',
          },
        },
        schemas: {
          Error: {
            type: 'object',
            required: ['isUserError', 'exceptionMessage', 'exceptionDetails'],
            properties: {
              isUserError: { type: 'boolean' },
              exceptionMessage: { type: 'string' },
              exceptionDetails: { type: 'string' },
            },
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  // Scalar already serves the document under its own route prefix, so this
  // publishes it at the conventional `/openapi.json` tooling path instead of
  // colliding with `/docs/openapi.json`.
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.log.info(`OpenAPI document available at ${config.docs.openapiPath}`);
}

async function registerScalar(app: FastifyInstance): Promise<void> {
  // `${routePrefix}/openapi.json`, i.e. `/docs/openapi.json` by default.
  const specSuffix = config.docs.openapiPath.startsWith(`${config.docs.path}/`)
    ? config.docs.openapiPath.slice(config.docs.path.length)
    : '/openapi.json';

  await app.register(scalar, {
    routePrefix: config.docs.path as `/${string}`,
    logLevel: 'silent',
    openApiDocumentEndpoints: { json: specSuffix as `/${string}` },
    configuration: {
      title: 'CarCare Co. API Reference',
      theme: 'purple',
      darkMode: false,
      persistAuth: true,
      hideDownloadButton: false,
      layout: 'modern',
      metaData: {
        title: 'CarCare Co. API Reference',
      },
    },
  });

  app.log.info(`Scalar API reference available at ${config.docs.path}`);
}

/**
 * `fastify-plugin` is required here: without it the plugin is encapsulated and
 * `@fastify/swagger` would only ever see the routes registered inside this file,
 * publishing an empty document.
 */
export const docsPlugin = fp(registerDocs, { name: 'docs' });

/**
 * Stays encapsulated so its `/docs/*` routes live in their own scope; it still
 * sees the root's swagger decorator because child scopes inherit parent ones.
 */
export const scalarPlugin = registerScalar;
