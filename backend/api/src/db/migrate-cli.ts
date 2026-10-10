/**
 * Applies the DbUp SQL scripts from `backend/src/DbUp/scripts` that have not
 * been recorded as applied yet.
 *
 *   npm run migrate
 *
 * DbUp itself remains the source of truth in Docker deployments; this CLI
 * exists so the TypeScript backend can bootstrap a database without the .NET
 * toolchain (local development, CI). Applied scripts are tracked in
 * `public.schema_migrations`, the same table DbUp uses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolForDatabase } from './pool.js';
import { config } from '../config/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, '..', '..', '..', 'src', 'DbUp', 'scripts');

async function migrate(): Promise<void> {
  const pool = poolForDatabase(config.db.name);
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        script text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const scripts = readdirSync(scriptsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of scripts) {
      const alreadyApplied = await client.query(
        'select 1 from public.schema_migrations where script = $1',
        [name],
      );
      if ((alreadyApplied.rowCount ?? 0) > 0) {
        console.log(`skip   ${name}`);
        continue;
      }

      const sql = readFileSync(path.join(scriptsDir, name), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into public.schema_migrations (script) values ($1)', [name]);
        await client.query('commit');
        console.log(`apply  ${name}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

migrate().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
