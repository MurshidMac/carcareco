import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { PageQuery, type PageResult } from '../../core/paging.js';
import { NotFoundError, UserError } from '../../core/errors.js';
import { hashPassword } from '../../core/auth/password.js';

/**
 * Port of `EmployeesController`.
 *
 * Employees live in the tenant database (`domain.employee`) while their optional
 * logins live in the central user list (`public.user`), so both handles are
 * needed to reproduce the original behaviour.
 */

export interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  proffession: string | null;
  description: string | null;
  introducedAt: string | null;
  /** Filled in from the user list, never stored on the employee row. */
  userName: string | null;
}

export interface Mechanic {
  id: string;
  name: string | null;
}

export interface EmployeeInput {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  proffession?: string | null | undefined;
  description?: string | null | undefined;
  introducedAt?: string | null | undefined;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * `GET /page` selected `employee.*` plus a placeholder `username` column that
 * `GetPage` then overwrote from the user list.
 */
const PAGE_PROJECTION = `select employee.*, '' as username from domain.employee`;

const SEARCH_FIELDS = "concat_ws(' ',firstname,lastname,email,phone)";

export class EmployeeRepository {
  constructor(
    private readonly db: Kysely<Database>,
    /** Handle for the database that owns `public.user`. */
    private readonly userDb: Kysely<Database>,
    private readonly tenantName: string,
  ) {}

  /** `EmployeesController.Get` — the `{id, name}` list of mechanics. */
  async listMechanics(): Promise<Mechanic[]> {
    const result = await sql<Mechanic>`
      select id, concat_ws(' ', firstname, lastname) as name
        from domain.employee
       order by name
    `.execute(this.db);

    return result.rows.map((row) => ({ id: row.id, name: row.name }));
  }

  /**
   * `EmployeesController.GetPage`.
   *
   * The username was not joined (the original left it commented out) but filled
   * in afterwards from the central user list, so the page is matched to users by
   * employee id.
   */
  async page(params: {
    searchText?: string | undefined;
    orderby?: string | undefined;
    limit: number;
    offset: number;
    desc: boolean;
  }): Promise<PageResult<Employee>> {
    const result = await new PageQuery(params, {
      allowedOrderBy: [
        'id',
        'firstname',
        'lastname',
        'email',
        'phone',
        'proffession',
        'description',
        'introducedat',
      ],
      defaultOrderBy: 'lastname',
    })
      .searchFields(SEARCH_FIELDS)
      .execute<EmployeeRow>(this.db, PAGE_PROJECTION);

    const users = await this.userListByEmployee();
    return {
      hasMore: result.hasMore,
      items: result.items.map((row) => ({
        id: row.id,
        firstName: row.firstname,
        lastName: row.lastname,
        phone: row.phone,
        email: row.email,
        proffession: row.proffession,
        description: row.description,
        introducedAt: iso(row.introducedat),
        userName: users.get(row.id) ?? null,
      })),
    };
  }

  async find(id: string): Promise<Employee | undefined> {
    const result = await sql<EmployeeRow>`
      select * from domain.employee where id = ${id}::uuid
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return undefined;

    const users = await this.userListByEmployee();
    return {
      id: row.id,
      firstName: row.firstname,
      lastName: row.lastname,
      phone: row.phone,
      email: row.email,
      proffession: row.proffession,
      description: row.description,
      introducedAt: iso(row.introducedat),
      userName: users.get(id) ?? null,
    };
  }

  async findOrFail(id: string): Promise<Employee> {
    const employee = await this.find(id);
    if (!employee) throw new NotFoundError('Employee');
    return employee;
  }

  /** Map of employeeId -> userName for this tenant, used to decorate pages. */
  private async userListByEmployee(): Promise<Map<string, string>> {
    const result = await sql<{ employeeid: string; username: string }>`
      select employeeid, username from public.user
       where tenantname = ${this.tenantName}
         and employeeid is not null
    `.execute(this.userDb);

    return new Map(result.rows.map((row) => [row.employeeid, row.username]));
  }

  async create(input: EmployeeInput & { userName?: string | null; password?: string | null }): Promise<string> {
    const id = randomUUID();

    await this.db.transaction().execute(async (tx) => {
      await sql`
        INSERT INTO domain.employee
          (id, firstname, lastname, email, phone, proffession, description, introducedat)
        VALUES (
          ${id}::uuid, ${input.firstName ?? null}, ${input.lastName ?? null},
          ${input.email ?? null}, ${input.phone ?? null}, ${input.proffession ?? null},
          ${input.description ?? null}, ${input.introducedAt ?? new Date().toISOString()}
        )
      `.execute(tx);
    });

    return id;
  }

  async update(id: string, input: EmployeeInput): Promise<void> {
    await this.findOrFail(id);

    await sql`
      UPDATE domain.employee SET
        firstname = ${input.firstName ?? null}, lastname = ${input.lastName ?? null},
        email = ${input.email ?? null}, phone = ${input.phone ?? null},
        proffession = ${input.proffession ?? null}, description = ${input.description ?? null}
      WHERE id = ${id}::uuid
    `.execute(this.db);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    // Logins referencing the employee would otherwise dangle, so they are removed
    // first. Under multi-tenancy `public.user` lives in a different database, so
    // the two deletes cannot share a transaction; the user rows go first, which
    // leaves a dangling employee rather than a login with no employee if this
    // fails midway.
    await sql`
      DELETE FROM public.user WHERE tenantname = ${this.tenantName}
        AND employeeid = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`})
    `.execute(this.userDb);

    await this.db.transaction().execute(async (tx) => {
      for (const id of ids) {
        await sql`DELETE FROM domain.employee WHERE id = ${id}::uuid`.execute(tx);
      }
    });
  }

  /**
   * `EmployeesController.AfterSaved`.
   *
   * Creating a login was a side effect of saving an employee with a `userName`:
   * a blank password was rejected, and a user name already in use was rejected
   * before the user row was written. `NewUser` hashed the password with
   * `PasswordHasher.getHash`.
   *
   * `password` is therefore the plaintext, validated and hashed here so the blank
   * check happens before any work is done.
   */
  async createLoginFor(
    employeeId: string,
    userName: string,
    plainPassword: string,
    email: string | null,
  ): Promise<void> {
    if (!plainPassword.trim()) {
      throw new UserError('Parool sisestamata.');
    }

    const taken = await sql<{ username: string }>`
      select username from public.user where username = ${userName} limit 1
    `.execute(this.userDb);

    if (taken.rows[0]) {
      throw new UserError('Seda kasutajanime ei saa kasutada.');
    }

    await sql`
      INSERT INTO public.user (tenantname, employeeid, username, password, email, validated, profile_image)
      VALUES (${this.tenantName}, ${employeeId}::uuid, ${userName}, ${await hashPassword(plainPassword)}, ${email}, false, null)
    `.execute(this.userDb);
  }
}

interface EmployeeRow {
  id: string;
  firstname: string | null;
  lastname: string | null;
  phone: string | null;
  email: string | null;
  proffession: string | null;
  description: string | null;
  introducedat: Date | string | null;
}
