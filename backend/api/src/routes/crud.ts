import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal, requireRootPrincipal } from '../plugins/context.js';
import {
  errorResponseSchema,
  idResponseSchema,
  validationErrorResponse,
} from '../schemas/common.js';

/**
 * Reproduces the `BaseController<MODEL, DOMAINOBJECT>` action set that clients,
 * vehicles, spare parts, storages and employees all inherited:
 *
 *   GET    /{id}   -> the record
 *   POST   /       -> bare id
 *   PUT    /{id}   -> bare id
 *   DELETE /       -> 200 with an empty body, taking an array of ids
 *
 * The odd parts of that contract are deliberate and load-bearing: POST and PUT
 * answer with the bare id rather than the record, and DELETE reads the ids from
 * the request *body* instead of the query string.
 */

const idParams = z.object({ id: z.string().uuid() });

const idsBodySchema = z.array(z.string().uuid()).describe('Identifiers to delete');

/** `OkResult` / `LocalRedirect` answered with no content. */
const emptyOk = { 200: z.null().describe('Acknowledged; empty body') };

export interface CrudHandlers<TBody> {
  /** Returns the record shown by `GET /{id}`. */
  find: (request: FastifyRequest, id: string) => Promise<unknown>;
  /** Returns the new id from `POST`. */
  create: (request: FastifyRequest, body: TBody) => Promise<string>;
  /** Applies `PUT /{id}`. */
  update: (request: FastifyRequest, id: string, body: TBody) => Promise<void>;
  /** Applies `DELETE` for the supplied ids. */
  remove: (request: FastifyRequest, ids: readonly string[]) => Promise<void>;
}

export interface CrudOptions<TBody> {
  /** Path prefix, e.g. `/vehicles`. */
  path: string;
  tags: string[];
  /** Human label used to build the OpenAPI summaries. */
  label: string;
  bodySchema: z.ZodType<TBody>;
  /** Response schema for `GET /{id}`. */
  recordSchema: z.ZodType;
  handlers: CrudHandlers<TBody>;
  /**
   * Which actions required `ServerSidePolicy` (the Root role).
   *
   * The legacy controllers were inconsistent: `StoragesController` and
   * `EmployeesController` put `[Authorize(Policy = "ServerSidePolicy")]` on the
   * class, so even POST was gated, while `VehiclesController` and
   * `SparePartsController` left reads and creates open and only gated
   * PUT/DELETE. Defaults to every action, which is the common case.
   */
  requireRoot?: { find?: boolean; create?: boolean; update?: boolean; remove?: boolean };
  /** Set when the resource has no `GET /{id}` action. */
  skipFind?: boolean;
}

export function registerCrud<TBody>(
  fastify: FastifyInstance,
  options: CrudOptions<TBody>,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { path, handlers } = options;
  const root = options.requireRoot ?? {};

  /** Resolves the guard for one action, defaulting to Root-required. */
  function guardFor(action: 'find' | 'create' | 'update' | 'remove') {
    return root[action] === false ? requirePrincipal : requireRootPrincipal;
  }

  function authResponses(action: 'find' | 'create' | 'update' | 'remove') {
    return root[action] === false ? {} : { 403: errorResponseSchema.describe('The Root role is required') };
  }

  if (!options.skipFind) {
    app.get(
      `${path}/:id`,
      {
        schema: {
          tags: options.tags,
          summary: `Get ${options.label}`,
          params: idParams,
          response: {
            200: options.recordSchema,
            400: validationErrorResponse[400],
            401: errorResponseSchema.describe('Authentication required'),
            404: errorResponseSchema.describe(`${options.label} not found`),
            ...authResponses('find'),
          },
        },
        preHandler: limits.tenant(),
      },
      async (request) => {
        guardFor('find')(request);
        return handlers.find(request, request.params.id);
      },
    );
  }

  app.post(
    path,
    {
      schema: {
        tags: options.tags,
        summary: `Create ${options.label}`,
        body: options.bodySchema,
        response: {
          ...idResponseSchema,
          400: validationErrorResponse[400],
          ...authResponses('create'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      guardFor('create')(request);
      return reply.send(await handlers.create(request, request.body as TBody));
    },
  );

  app.put(
    `${path}/:id`,
    {
      schema: {
        tags: options.tags,
        summary: `Update ${options.label}`,
        params: idParams,
        body: options.bodySchema,
        response: {
          ...idResponseSchema,
          400: validationErrorResponse[400],
          ...authResponses('update'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      guardFor('update')(request);
      await handlers.update(request, request.params.id, request.body as TBody);
      return reply.send(request.params.id);
    },
  );

  app.delete(
    path,
    {
      schema: {
        tags: options.tags,
        summary: `Delete ${options.label}`,
        body: idsBodySchema,
        response: {
          ...emptyOk,
          400: validationErrorResponse[400],
          401: errorResponseSchema.describe('Authentication required'),
          ...authResponses('remove'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      guardFor('remove')(request);
      await handlers.remove(request, request.body);
      return reply.code(200).send(null);
    },
  );
}
