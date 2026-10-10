import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { generateToken, verifyToken, tokenFromHeaders } from '../src/core/auth/jwt.js';

const LEGACY_CLAIMS_BASE = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
const EMPLOYEE_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Signs a token with the configured secret but without an `iss` claim, i.e.
 * exactly the shape the original ASP.NET backend issued.
 */
async function signLegacy(claims: Record<string, unknown>, expiresIn = '1h'): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(process.env['JWT_SECRET'] ?? ''));
}

function legacyClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unique_name: 'jane',
    FullName: 'Jane Doe',
    [`${LEGACY_CLAIMS_BASE}/spn`]: 'tenant-a',
    [`${LEGACY_CLAIMS_BASE}/userdata`]: EMPLOYEE_ID,
    role: 'Root',
    ...extra,
  };
}

describe('verifyToken', () => {
  it('accepts a token with no `iss` claim, as issued by the .NET backend', async () => {
    const token = await signLegacy(legacyClaims());
    // Requiring an issuer here would invalidate every session that outlived a
    // cut-over to this backend, because the old tokens never carried one.
    const principal = await verifyToken(token);
    expect(principal.tenantName).toBe('tenant-a');
    expect(principal.fullName).toBe('Jane Doe');
    expect(principal.isRoot).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT(legacyClaims())
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value-000000'));

    await expect(verifyToken(token)).rejects.toThrow(/invalid or has expired/i);
  });

  it('rejects an expired token', async () => {
    const token = await signLegacy(legacyClaims(), '0s');
    await expect(verifyToken(token)).rejects.toThrow(/invalid or has expired/i);
  });

  it('rejects a token that lacks the tenant claim', async () => {
    const claims = legacyClaims();
    delete claims[`${LEGACY_CLAIMS_BASE}/spn`];
    const token = await signLegacy(claims);
    await expect(verifyToken(token)).rejects.toThrow(/missing required claims/i);
  });

  it('round-trips its own tokens, granting Root only on the privileged one', async () => {
    const input = {
      userName: 'jane',
      fullName: 'Jane Doe',
      tenantName: 'tenant-a',
      employeeId: EMPLOYEE_ID,
    };

    const privileged = await generateToken({ ...input, publicUse: false });
    const browser = await generateToken({ ...input, publicUse: true });

    expect((await verifyToken(privileged)).isRoot).toBe(true);
    // The browser token must never satisfy the Root check, otherwise the
    // ServerSidePolicy equivalent would be reachable from the client.
    expect((await verifyToken(browser)).isRoot).toBe(false);
    expect((await verifyToken(browser)).tenantName).toBe('tenant-a');
  });
});

describe('tokenFromHeaders', () => {
  it('reads a bearer token', () => {
    expect(tokenFromHeaders({ authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi');
  });

  it('is case insensitive on the scheme', () => {
    expect(tokenFromHeaders({ authorization: 'bearer abc' })).toBe('abc');
  });

  it('falls back to the jwt_token cookie', () => {
    expect(tokenFromHeaders({ 'jwt_token': 'other=1; jwt_token=abc; another=2' })).toBe('abc');
  });

  it('url-decodes the cookie value', () => {
    expect(tokenFromHeaders({ 'jwt_token': 'jwt_token=a%2Bb' })).toBe('a+b');
  });

  it('prefers the authorization header over the cookie', () => {
    expect(
      tokenFromHeaders({ authorization: 'Bearer fromheader', 'jwt_token': 'jwt_token=fromcookie' }),
    ).toBe('fromheader');
  });

  it('returns undefined when nothing is present', () => {
    expect(tokenFromHeaders({})).toBeUndefined();
  });
});