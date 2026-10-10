import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import fp from 'fastify-plugin';
import { AppError, TooManyRequestsError, type ErrorBody } from '../core/errors.js';

/**
 * Preserves the error envelope consumed by the existing frontend:
 * `src/_lib/server/query-api.ts` reads `exceptionMessage` and `isUserError`
 * from any JSON error response.
 */
function bodyFor(error: unknown): { statusCode: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, body: error.toBody() };
  }

  // Request validation. `fastify-type-provider-zod` raises a plain
  // `FastifyError` whose `validation` array holds the Zod issues, so an
  // `instanceof ZodError` check alone would miss these and let them fall
  // through to the 500 branch.
  if (hasZodFastifySchemaValidationErrors(error)) {
    const messages = error.validation.map((entry) => {
      const where = entry.instancePath ? ` (${entry.instancePath.replace(/^\//, '').replace(/\//g, '.')})` : '';
      return `${entry.message ?? 'Invalid input.'}${where}`;
    });

    return {
      statusCode: 400,
      body: {
        isUserError: true,
        exceptionMessage: messages.length
          ? `Invalid input: ${messages.join(', ')}`
          : 'The request was not valid.',
        exceptionDetails: JSON.stringify(error.validation, null, 2),
      },
    };
  }

  // A response that does not match its declared Zod schema is a bug in this
  // service, not the caller's fault, so it stays a 500 but is logged loudly.
  if (isResponseSerializationError(error)) {
    return {
      statusCode: 500,
      body: {
        isUserError: false,
        exceptionMessage: 'The response did not match its declared schema.',
        exceptionDetails: error.cause?.message ?? '',
      },
    };
  }

  // Foreign-key violations while deleting surface as a friendly message in the
  // .NET backend (JsonErrorDto.IsPosgresTryingToDeleteButRelatedDataExists).
  const pgError = error as { code?: string; constraint?: string; message?: string };
  if (pgError?.code === '23503') {
    return {
      statusCode: 409,
      body: {
        isUserError: true,
        exceptionMessage:
          'Problem occured while deleting data, there is other data associated with it, preventing the removal.',
        exceptionDetails: pgError.message ?? '',
      },
    };
  }

  if (pgError?.code === '23505') {
    return {
      statusCode: 409,
      body: {
        isUserError: true,
        exceptionMessage: 'A record with the same unique value already exists.',
        exceptionDetails: pgError.message ?? '',
      },
    };
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return {
    statusCode: 500,
    body: {
      isUserError: false,
      // The frontend renders `exceptionMessage` in a full-page error view, so
      // it must stay generic. The stack goes to the log and to
      // `exceptionDetails`, which the frontend never displays.
      exceptionMessage: 'An unexpected error occurred while processing the request.',
      exceptionDetails: `${message}\n${error instanceof Error ? (error.stack ?? '') : String(error)}`,
    },
  };
}

async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    reply.status(404).send({
      isUserError: true,
      exceptionMessage: `Route ${request.method} ${request.url} not found.`,
      exceptionDetails: '',
    } satisfies ErrorBody),
  );

  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, body } = bodyFor(error);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    } else {
      request.log.info({ msg: body.exceptionMessage }, 'request rejected');
    }

    if (error instanceof TooManyRequestsError) {
      reply.header('Retry-After', String(error.retryAfterSeconds));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.header('X-Validation-Errors', String(error.validation.length));
    }

    return reply.status(statusCode).send(body);
  });
}

export const errorHandlerPlugin = fp(registerErrorHandler, {
  name: 'error-handler',
  dependencies: [],
});
