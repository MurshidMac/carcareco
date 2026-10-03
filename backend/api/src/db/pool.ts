import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';
import { config } from '../config/index.js';

/**
 * One connection pool per database. Multi-tenant deployments route every
 * request to a different database, so pools are created lazily and reused.
 */
const pools = new Map<string, pg.Pool>();
const kyselies = new Map<string, Kysely<Database>>();

/**
 * node-pg returns `int8` (bigint) as a string to avoid precision loss. This API
 * uses `double precision` throughout, but aggregates such as `count(*)` also
 * arrive as strings — normalise those to numbers so JSON output stays numeric.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export function buildConnectionString(database: string): string {
  const { host, port, user, password } = config.db;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function poolFor(database: string): pg.Pool {
  let pool = pools.get(database);
  if (!pool) {
    pool = new pg.Pool({
      connectionString: buildConnectionString(database),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool-level error handler is required; without it an idle client error
    // escalates to an unhandled 'error' event and kills the process.
    pool.on('error', (err) => {
      console.error('[db] idle client error', err.message);
    });
    pools.set(database, pool);
  }
  return pool;
}

export function dbFor(database: string): Kysely<Database> {
  let instance = kyselies.get(database);
  if (!instance) {
    instance = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: poolFor(database) }),
    });
    kyselies.set(database, instance);
  }
  return instance;
}

/** Raw pool access, for migrations and other multi-statement scripts. */
export function poolForDatabase(database: string): pg.Pool {
  return poolFor(database);
}

/** Health check: verifies the database is reachable. */
export async function ping(database: string): Promise<void> {
  await sql`select 1`.execute(dbFor(database));
}

export async function closeAllPools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  kyselies.clear();
  await Promise.all(open.map((pool) => pool.end()));
}
