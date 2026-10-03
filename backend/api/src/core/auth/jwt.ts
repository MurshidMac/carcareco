import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../../config/index.js';
import { claimsForPrincipal, principalFromClaims, type ClaimBag, type Principal } from './claims.js';
import { AppError } from '../errors.js';

const ALG = 'HS256';
const ISSUER = 'carcare-api';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config.jwt.secret);
}

export interface TokenInput {
  userName: string;
  fullName: string;
  tenantName: string;
  employeeId: string;
  /**
   * False yields the privileged token carrying `role: Root` (used by the
   * Next.js server components). True yields the browser-facing token with no
   * role, which therefore cannot satisfy the `ServerSidePolicy` role check.
   */
  publicUse: boolean;
}

/** Mirrors `AppJwtToken.Generate`. */
export async function generateToken(input: TokenInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claimsForPrincipal(input))
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setExpirationTime(now + config.jwt.sessionTimeoutSeconds)
    .sign(secretKey());
}

/**
 * Mirrors `AppJwtToken.LoadJwt` / the JwtBearer handler: the signature and the
 * expiry are verified, but issuer and audience are not, and there is zero clock
 * skew.
 *
 * Tokens issued by the original ASP.NET backend carried no `iss` claim, so the
 * issuer cannot be required here even though this implementation sets one on
 * newly issued tokens. Requiring it would invalidate every session that
 * survived a cut-over to this backend.
 */
export async function verifyToken(token: string): Promise<Principal> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      algorithms: [ALG],
      // The .NET backend issued tokens without an `aud` claim.
      audience: undefined,
      clockTolerance: 0,
    }));
  } catch (cause) {
    throw new AppError('The access token is invalid or has expired.', {
      statusCode: 401,
      details: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const principal = principalFromClaims(payload as ClaimBag);
  if (!principal) {
    throw new AppError('The access token is missing required claims.', { statusCode: 401 });
  }
  return principal;
}

/**
 * Extracts a bearer token from the request. Mirrors the JwtBearer
 * `OnMessageReceived` hook, which also accepted a `jwt_token` cookie.
 */
export function tokenFromHeaders(headers: {
  authorization?: string | string[] | undefined;
  'jwt_token'?: string | string[] | undefined;
}): string | undefined {
  const auth = typeof headers.authorization === 'string' ? headers.authorization : undefined;
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
    // Tolerate a bare token in the Authorization header.
    if (!auth.includes(' ')) return auth.trim();
  }
  const cookie = typeof headers['jwt_token'] === 'string' ? headers['jwt_token'] : undefined;
  if (cookie) {
    const match = /(?:^|;\s*)jwt_token=([^;]+)/.exec(cookie);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}
