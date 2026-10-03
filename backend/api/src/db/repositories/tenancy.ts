import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { dbFor } from '../pool.js';
import { tenantDatabaseName, wellKnownDatabaseName } from '../../core/tenancy.js';
import { hashPassword } from '../../core/auth/password.js';
import { shortGuid } from '../../core/sequences.js';
import { AppError } from '../../core/errors.js';
import { config } from '../../config/index.js';
import { UserRepository } from './users.js';

/**
 * Port of `TenancyRepository` and `DemoSetupService`: provisions a brand new
 * tenant by cloning the template database, then seeds it with sample data.
 */

export interface DemoCredentials {
  username: string;
  password: string;
  tenantName: string;
}

export class TenancyRepository {
  /** The tenancy database holds `public.user` for every tenant. */
  private get tenancyDb(): Kysely<Database> {
    return dbFor(wellKnownDatabaseName('tenancy'));
  }

  async createTenantDatabase(tenantName: string): Promise<void> {
    const userDbName = tenantDatabaseName(tenantName);
    const templateDbName = wellKnownDatabaseName('template');

    // `CREATE DATABASE ... TEMPLATE ...` cannot run inside a transaction and
    // cannot be parameterised, but both names are derived from configuration
    // plus a generated token. Identifiers are still double-quoted.
    await this.tenancyDb.executeQuery(
      sql.raw(
        `create database "${userDbName.replace(/"/g, '""')}" template "${templateDbName.replace(/"/g, '""')}"`,
      ).compile(this.tenancyDb),
    );
  }

  async createTenantUser(
    tenantName: string,
    userName: string,
    hashedPassword: string,
    employeeId: string,
    profileImage: Buffer | null,
  ): Promise<void> {
    await this.tenancyDb
      .insertInto('user')
      .values({
        tenantname: tenantName,
        employeeid: employeeId,
        username: userName,
        password: hashedPassword,
        email: 'demo@example.com',
        validated: true,
        profile_image: profileImage,
      })
      .execute();
  }
}

const DEMO_CLIENTS = [
  {
    kind: 'legal' as const,
    name: 'Demo Company',
    address: 'Main Street 123',
    country: 'USA',
    region: 'CA',
    city: 'San Francisco',
    postalcode: '94105',
    phone: '+1 987 654 321',
    description: 'Demo Company Client',
    email: 'company@example.com',
    regnr: 'REG12345',
  },
  {
    kind: 'private' as const,
    firstname: 'John',
    lastname: 'Doe',
    personalcode: 'ID12345',
    address: 'Side Street 456',
    country: 'USA',
    region: 'CA',
    city: 'San Francisco',
    postalcode: '94107',
    phone: '+1 567 890 123',
    description: 'Demo Private Client',
    email: 'john.doe@example.com',
  },
];

export class DemoSetupService {
  private readonly tenancy = new TenancyRepository();

  async createDemoTenant(companyName?: string | null): Promise<DemoCredentials> {
    if (!config.db.multiTenancy.enabled) {
      throw new AppError('Demo setup requires multi-tenancy to be enabled', { statusCode: 400 });
    }

    const tenantName = shortGuid();
    const userName = `demo${tenantName}`;
    const password = 'carcare';
    const hashedPassword = await hashPassword(password);
    const adminEmployeeId = randomUUID();

    await this.tenancy.createTenantDatabase(tenantName);
    await this.tenancy.createTenantUser(tenantName, userName, hashedPassword, adminEmployeeId, null);

    const db = dbFor(tenantDatabaseName(tenantName));
    await this.seed(db, adminEmployeeId, companyName ?? 'Demo Company');

    const users = new UserRepository(dbFor(wellKnownDatabaseName('tenancy')));
    await users.setEmployeeId(tenantName, adminEmployeeId);

    return { username: userName, password, tenantName };
  }

  private async seed(db: Kysely<Database>, adminEmployeeId: string, companyName: string): Promise<void> {
    const now = new Date();

    await db
      .insertInto('employee')
      .values({
        id: adminEmployeeId,
        firstname: 'Demo',
        lastname: 'Admin',
        email: 'admin@example.com',
        phone: '+1234567890',
        proffession: 'Administrator',
        description: 'Demo Admin Account',
        introducedat: now,
      })
      .execute();

    await db
      .updateTable('tenant_config.requisites')
      .set({ name: companyName, updated_at: sql`now()` })
      .execute();

    await db
      .insertInto('storage')
      .values({
        id: randomUUID(),
        name: 'Main Storage',
        address: 'Storage Address',
        description: 'Main storage facility',
        introducedat: now,
      })
      .execute();

    for (const client of DEMO_CLIENTS) {
      const clientId = randomUUID();
      await db
        .insertInto('client')
        .values({
          id: clientId,
          address: client.address,
          country: client.country,
          region: client.region,
          city: client.city,
          postalcode: client.postalcode,
          phone: client.phone,
          description: client.description,
          isasshole: false,
          introducedat: now,
        })
        .execute();

      if (client.kind === 'legal') {
        await db
          .insertInto('legalclient')
          .values({ id: clientId, name: client.name, regnr: client.regnr })
          .execute();
      } else {
        await db
          .insertInto('privateclient')
          .values({
            id: clientId,
            firstname: client.firstname,
            lastname: client.lastname,
            personalcode: client.personalcode,
          })
          .execute();
      }

      await db
        .insertInto('clientemail')
        .values({ address: client.email, clientid: clientId, isactive: true })
        .execute();
    }
  }
}
