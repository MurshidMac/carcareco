import { type Kysely } from 'kysely';
import type { Database } from '../types.js';
import { config } from '../../config/index.js';
import { UserError, NotFoundError } from '../../core/errors.js';

/**
 * Port of `Carmasters.Core.Repository.Postgres.UserRepository`.
 *
 * Users always live in `public.user`, which is either the primary database or —
 * when multi-tenancy is on — centralised in the tenancy database. A user's
 * identity is the pair (tenantName, employeeId).
 */

export interface UserRecord {
  userName: string;
  password: string;
  email: string | null;
  validated: boolean;
  profileImage: Buffer | null;
  tenantName: string;
  employeeId: string | null;
}

const MAX_PROFILE_IMAGE_BYTES = config.maxProfileImageBytes;

export class UserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getByUserName(userName: string): Promise<UserRecord | undefined> {
    const row = await this.db
      .selectFrom('user')
      .select([
        'username as userName',
        'password',
        'email',
        'validated',
        'profile_image as profileImage',
        'tenantname as tenantName',
        'employeeid as employeeId',
      ])
      .where('username', '=', userName)
      .executeTakeFirst();
    return row;
  }

  async getByIdentifier(tenantName: string, employeeId: string): Promise<UserRecord | undefined> {
    return this.db
      .selectFrom('user')
      .select([
        'username as userName',
        'password',
        'email',
        'validated',
        'profile_image as profileImage',
        'tenantname as tenantName',
        'employeeid as employeeId',
      ])
      .where('tenantname', '=', tenantName)
      .where('employeeid', '=', employeeId)
      .executeTakeFirst();
  }

  async allByTenant(tenantName: string): Promise<UserRecord[]> {
    return this.db
      .selectFrom('user')
      .select([
        'username as userName',
        'password',
        'email',
        'validated',
        'profile_image as profileImage',
        'tenantname as tenantName',
        'employeeid as employeeId',
      ])
      .where('tenantname', '=', tenantName)
      .execute();
  }

  async isUserNameTaken(userName: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('user')
      .select('username')
      .where('username', '=', userName)
      .executeTakeFirst();
    return row !== undefined;
  }

  async update(user: UserRecord & { employeeId: string }): Promise<void> {
    if (user.profileImage && user.profileImage.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new UserError('Profile image is too big');
    }
    const result = await this.db
      .updateTable('user')
      .set({
        username: user.userName,
        password: user.password,
        email: user.email,
        validated: user.validated,
        profile_image: user.profileImage,
      })
      .where('tenantname', '=', user.tenantName)
      .where('employeeid', '=', user.employeeId)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw new NotFoundError(`User ${user.tenantName}/${user.employeeId}`);
    }
  }

  async insert(user: UserRecord & { employeeId: string }): Promise<void> {
    await this.db
      .insertInto('user')
      .values({
        tenantname: user.tenantName,
        employeeid: user.employeeId,
        username: user.userName,
        password: user.password,
        email: user.email,
        validated: user.validated,
        profile_image: user.profileImage,
      })
      .execute();
  }

  /** Back-fills `employeeid` on the demo user created before its employee row. */
  async setEmployeeId(tenantName: string, employeeId: string): Promise<void> {
    await this.db
      .updateTable('user')
      .set({ employeeid: employeeId })
      .where('tenantname', '=', tenantName)
      .where('employeeid', 'is', null)
      .execute();
  }
}

/** Decodes a base64 profile image, rejecting oversized payloads. */
export function decodeProfileImage(base64: string | null | undefined): Buffer | null {
  if (base64 === null || base64 === undefined || base64.trim() === '') return null;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new UserError('Profile image is too big');
  }
  return buffer;
}
