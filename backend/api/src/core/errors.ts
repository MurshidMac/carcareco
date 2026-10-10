/**
 * Error model.
 *
 * The wire shape is fixed by the existing frontend
 * (`src/_lib/server/query-api.ts`): it reads `exceptionMessage` for the toast
 * text and `isUserError` to decide between a toast + redirect back and a full
 * error page. Do not rename these fields.
 */

export interface ErrorBody {
  /** True when the failure is caused by the caller's input rather than a server fault. */
  isUserError: boolean;
  exceptionMessage: string;
  exceptionDetails: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly isUserError: boolean;
  readonly details: unknown;

  constructor(
    message: string,
    options: { statusCode?: number; isUserError?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options.statusCode ?? 500;
    this.isUserError = options.isUserError ?? false;
    this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }

  toBody(): ErrorBody {
    const details =
      this.details === undefined
        ? ''
        : typeof this.details === 'string'
          ? this.details
          : this.details instanceof Error
            ? (this.details.stack ?? this.details.message)
            : JSON.stringify(this.details, null, 2);
    return {
      isUserError: this.isUserError,
      exceptionMessage: this.message,
      exceptionDetails: details,
    };
  }
}

/** Validation / rule violation caused by the caller. Surfaces as a toast in the UI. */
export class UserError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 400, isUserError: true, details });
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found.`, { statusCode: 404, isUserError: true });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized.') {
    super(message, { statusCode: 401, isUserError: false });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden.') {
    super(message, { statusCode: 403, isUserError: false });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 409, isUserError: true });
  }
}

export class TooManyRequestsError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message, { statusCode: 429, isUserError: true });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Mirrors `Carmasters.Core.Domain.UserException`. */
export { UserError as DomainUserError };
