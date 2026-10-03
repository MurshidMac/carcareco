import { config } from '../config/index.js';
import { AppError } from './errors.js';

/**
 * Database name resolution, ported from
 * `Carmasters.Core.Application/Database/MultiTenancyDbName.cs`.
 *
 * Naming is entirely configuration driven — never hardcoded — and the
 * fail-fast validation of the original is preserved.
 */

export type DbKind = 'tenancy' | 'template';

function ensureTenancyEnabled(): void {
  if (!config.db.multiTenancy.enabled) {
    throw new AppError('MultiTenancy not enabled.', { statusCode: 500 });
  }
}

function ensureNamePresent(): void {
  if (!config.db.name || config.db.name.trim() === '') {
    throw new AppError("'DbOptions.Name' cannot be null or whitespace.", { statusCode: 500 });
  }
}

/** `{name}-{tenantName}` */
export function tenantDatabaseName(tenantName: string): string {
  ensureNamePresent();
  ensureTenancyEnabled();
  if (!tenantName || tenantName.trim() === '') {
    throw new AppError("'tenantName' cannot be null or whitespace.", { statusCode: 500 });
  }
  return `${config.db.name}-${tenantName}`;
}

/** `{name}-{tenancy}` or `{name}-{template}` */
export function wellKnownDatabaseName(kind: DbKind): string {
  ensureNamePresent();
  ensureTenancyEnabled();
  const { tenancy, template } = config.db.multiTenancy.suffix;
  if (!tenancy || !template) {
    throw new AppError('Multitenancy options not complete, check your configuration', { statusCode: 500 });
  }
  return `${config.db.name}-${kind === 'template' ? template : tenancy}`;
}

/**
 * Database holding the tenant's domain data. Without multi-tenancy this is
 * simply the primary database.
 */
export function domainDatabaseName(tenantName: string | undefined | null): string {
  return config.db.multiTenancy.enabled ? tenantDatabaseName(tenantName ?? '') : config.db.name;
}

/**
 * Database holding `public.user`. Mirrors `UserRepository.GetUserListDatabase`:
 * with multi-tenancy every tenant's users are centralised in the tenancy
 * database, otherwise they live in the primary database.
 */
export function userListDatabaseName(): string {
  return config.db.multiTenancy.enabled ? wellKnownDatabaseName('tenancy') : config.db.name;
}

/**
 * Database used to look up a specific user's profile (e.g. resolving a full
 * name from `domain.employee`). Mirrors `UserRepository.GetUserDatabase`.
 */
export function userProfileDatabaseName(tenantName: string): string {
  return config.db.multiTenancy.enabled ? tenantDatabaseName(tenantName) : config.db.name;
}
