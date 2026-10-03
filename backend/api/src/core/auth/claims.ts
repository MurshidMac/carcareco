/**
 * Claim names.
 *
 * ASP.NET Core's `JwtSecurityTokenHandler` rewrites well-known `ClaimTypes`
 * to their short JWT aliases (`ClaimTypes.Name` -> `unique_name`,
 * `ClaimTypes.Role` -> `role`) but leaves unmapped types as their full XML
 * URI. `ClaimTypes.Spn` and `ClaimTypes.UserData` are *not* in the default
 * outbound map, so tokens issued by the .NET backend carry:
 *
 *   unique_name                                        <- ClaimTypes.Name
 *   FullName                                           <- custom, verbatim
 *   http://schemas.xmlsoap.org/ws/2005/05/identity/claims/spn
 *   http://schemas.xmlsoap.org/ws/2005/05/identity/claims/userdata
 *   role                                               <- ClaimTypes.Role
 *
 * The frontend reads `FullName` directly from the decoded public token, so
 * that name must be preserved. `resolve*` below accepts both the long URI and
 * the short alias so tokens minted by either backend validate.
 */

const IDENTITY_CLAIM_BASE = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';

export const CLAIM = {
  name: ['unique_name', 'name', `${IDENTITY_CLAIM_BASE}/name`] as const,
  fullName: ['FullName', 'fullname', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/fullname'] as const,
  spn: ['spn', `${IDENTITY_CLAIM_BASE}/spn`] as const,
  userData: [
    'user_data',
    `${IDENTITY_CLAIM_BASE}/userdata`,
    `${IDENTITY_CLAIM_BASE}/userData`,
  ] as const,
  role: ['role', `${IDENTITY_CLAIM_BASE}/role`, 'roles'] as const,
} as const;

export type ClaimBag = Record<string, unknown>;

function resolve(bag: ClaimBag, names: readonly string[]): string | undefined {
  for (const key of names) {
    const value = bag[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0] !== '') return value[0];
  }
  return undefined;
}

/** Authenticated user identity, derived from a verified token. */
export interface Principal {
  userName: string;
  fullName: string;
  /** Tenant / company name. Drives database selection and tenant rate limits. */
  tenantName: string;
  employeeId: string;
  roles: string[];
  /** True when the token carries the internal `Root` role (server-to-server use). */
  isRoot: boolean;
}

export function principalFromClaims(bag: ClaimBag): Principal | undefined {
  const tenantName = resolve(bag, CLAIM.spn);
  const employeeId = resolve(bag, CLAIM.userData);
  if (!tenantName || !employeeId) return undefined;

  // Collect every value under every accepted role claim name, so tokens using
  // the long ClaimTypes URI are not treated as role-less.
  const roles: string[] = [];
  for (const key of CLAIM.role) {
    const value = bag[key];
    if (typeof value === 'string' && value.trim() !== '') roles.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim() !== '') roles.push(entry);
      }
    }
  }

  return {
    userName: resolve(bag, CLAIM.name) ?? '',
    fullName: resolve(bag, CLAIM.fullName) ?? '',
    tenantName,
    employeeId,
    roles,
    isRoot: roles.includes('Root'),
  };
}

/** Builds the claim bag for a freshly issued token. */
export function claimsForPrincipal(p: {
  userName: string;
  fullName: string;
  tenantName: string;
  employeeId: string;
  publicUse: boolean;
}): ClaimBag {
  return {
    unique_name: p.userName,
    FullName: p.fullName,
    [`${IDENTITY_CLAIM_BASE}/spn`]: p.tenantName,
    [`${IDENTITY_CLAIM_BASE}/userdata`]: p.employeeId,
    ...(p.publicUse ? {} : { role: 'Root' }),
  };
}
