import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
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

  if (error instanceof ZodError) {
    const first = error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return {
      statusCode: 400,
      body: {
        isUserError: true,
        exceptionMessage: `${first?.message ?? 'Validation failed.'}${where}`,
        exceptionDetails: JSON.stringify(error.issues, null, 2),
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
      exceptionMessage: message,
      exceptionDetails: error instanceof Error ? (error.stack ?? '') : String(error),
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
    if (error instanceof ZodError) {
      reply.header('X-Validation-Errors', String(error.issues.length));
    }

    return reply.status(statusCode).send(body);
  });
}

export const errorHandlerPlugin = fp(registerErrorHandler, {
  name: 'error-handler',
  dependencies: [],
});
