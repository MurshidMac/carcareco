import bcrypt from 'bcryptjs';

/**
 * Port of `Carmasters.Core.Application.Authorization.PasswordHasher`
 * (BCrypt.Net). Work factor 11 matches the .NET default so newly written
 * hashes are interchangeable with the legacy backend, and any `$2a$`/`$2b$`/
 * `$2y$` hash produced by either implementation verifies here.
 */
const WORK_FACTOR = 11;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, WORK_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
