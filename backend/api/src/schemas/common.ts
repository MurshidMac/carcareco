import { z } from 'zod';

/** Shared primitives. Response schemas are camelCase to match System.Text.Json. */

export const uuidSchema = z.string().uuid();

/** ISO-8601 timestamp. */
export const dateTimeSchema = z.string();

export const nullableDateTimeSchema = dateTimeSchema.nullish().transform((v) => v ?? null);

/** `double precision` in Postgres; JSON number on the wire. */
export const moneySchema = z.number();

export const nullableMoneySchema = z.number().nullish().transform((v) => v ?? null);

export const shortSchema = z.number().int();

export const nullableShortSchema = z.number().int().nullish().transform((v) => v ?? null);

/**
 * Error envelope. The frontend (`src/_lib/server/query-api.ts`) reads
 * `exceptionMessage` and `isUserError`; both names are contractual.
 */
export const errorResponseSchema = z
  .object({
    isUserError: z.boolean().describe('True when the failure was caused by the caller.'),
    exceptionMessage: z.string().describe('Human readable message, shown to the user.'),
    exceptionDetails: z.string().describe('Diagnostic detail. Not shown to the user.'),
  })
  .describe('Error');

/**
 * Builds a `fastify-type-provider-zod` response entry.
 *
 * The Zod schema must be passed under the `schema` key. Spreading a Zod object
 * (`...errorResponseSchema`) copies its internal fields instead and produces an
 * unusable response definition, so responses are constructed only here.
 */
function errorResponse(
  statusCode: number,
  description: string,
): Record<number, { description: string; schema: typeof errorResponseSchema }> {
  return { [statusCode]: { description, schema: errorResponseSchema } };
}

export const notFoundResponse = errorResponse(404, 'Not found');

export const unauthorizedResponse = errorResponse(
  401,
  'Authentication required, or the token is invalid or expired',
);

export const forbiddenResponse = errorResponse(
  403,
  'The token lacks the Root role required by this endpoint',
);

export const validationErrorResponse = errorResponse(
  400,
  'The request body or query string failed validation',
);

export const rateLimitedResponse = errorResponse(429, 'Rate limit exceeded');

export const internalErrorResponse = errorResponse(
  500,
  'The request failed because of an unexpected server-side error',
);

/** Most create/update endpoints answer with the bare id, not an object. */
export const idSchema = z.string().uuid();

export const idResponseSchema = {
  200: { description: 'The identifier of the affected record', schema: idSchema },
} as const;

/** Shared acknowledgement shape. */
export const okSchema = z.object({ ok: z.boolean() }).describe('Acknowledged');

export const okResponseSchema = {
  200: { description: 'Acknowledged', schema: okSchema },
} as const;

export const idsBodySchema = z.array(uuidSchema);

/** Shared paging/search query parameters. */
export const pageQuerySchema = z.object({
  searchText: z.string().optional().describe('Free text matched against the searchable columns'),
  orderby: z.string().optional().describe('SQL column to order by'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
  desc: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true')
    .describe('Sort descending'),
});

/**
 * `PagedResult<T>` from the .NET API. `hasMore` is computed by fetching
 * `limit + 1` rows and discarding the extra one.
 */
export function pagedResultSchema<T extends z.ZodType>(item: T, description: string) {
  return z
    .object({
      hasMore: z.boolean().describe('True when at least one more row exists beyond this page'),
      items: z.array(item),
    })
    .describe(description);
}

/**
 * Assembles the response map for a route from the errors it can return.
 * Keeps the OpenAPI document consistent without repeating boilerplate.
 */
export function standardResponses(schema: z.ZodType, description: string) {
  return {
    200: { description, schema },
    400: validationErrorResponse[400],
    401: unauthorizedResponse[401],
    403: forbiddenResponse[403],
    404: notFoundResponse[404],
  } as const;
}