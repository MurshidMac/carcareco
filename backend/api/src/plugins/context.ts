import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { dbFor } from '../db/pool.js';
import { domainDatabaseName, userListDatabaseName } from '../core/tenancy.js';
import { tokenFromHeaders, verifyToken } from '../core/auth/jwt.js';
import type { Principal } from '../core/auth/claims.js';
import { AppError, UnauthorizedError } from '../core/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Populated when the request carries a valid token. Absent for anonymous
     * endpoints (login, demo setup, profile pictures).
     */
    principal: Principal | null;
    /** Kysely handle bound to this request's tenant database. */
    tenantDb: () => Kysely<Database>;
    /** Kysely handle for the database holding `public.user`. */
    userListDb: () => Kysely<Database>;
  }
}

/** Reads the verified principal, throwing 401 when the request is anonymous. */
export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) throw new UnauthorizedError();
  return request.principal;
}

/**
 * Reads the verified principal and enforces the internal `Root` role — the
 * equivalent of the .NET `ServerSidePolicy`. Tokens handed to the browser are
 * deliberately role-less, so browser traffic can only reach the endpoints that
 * were anonymous or merely `[Authorize]`d in the original.
 */
export function requireRootPrincipal(request: FastifyRequest): Principal {
  const principal = requirePrincipal(request);
  if (!principal.isRoot) {
    throw new AppError('The Root role is required for this operation.', { statusCode: 403 });
  }
  return principal;
}

export function currentEmployeeId(request: FastifyRequest): string | undefined {
  return request.principal?.employeeId;
}

export function currentTenantName(request: FastifyRequest): string | undefined {
  return request.principal?.tenantName;
}

async function contextPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('principal', null);

  app.decorateRequest('tenantDb', function tenantDb(this: FastifyRequest): Kysely<Database> {
    const tenant = this.principal?.tenantName;
    return dbFor(domainDatabaseName(tenant));
  });

  app.decorateRequest('userListDb', function userListDb(): Kysely<Database> {
    return dbFor(userListDatabaseName());
  });

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = tokenFromHeaders(request.headers);
    if (!token) return;
    try {
      request.principal = await verifyToken(token);
    } catch {
      // An invalid token is treated as an anonymous request; endpoints that
      // require authentication raise 401 themselves. This matches the .NET
      // behaviour for `[AllowAnonymous]` routes.
      request.principal = null;
    }
  });
}

export const requestContextPlugin = fp(contextPlugin, { name: 'request-context' });
