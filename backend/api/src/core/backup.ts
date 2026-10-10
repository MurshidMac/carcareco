import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config/index.js';
import { AppError } from './errors.js';

const run = promisify(execFile);

/**
 * Port of `DatabaseBackup`.
 *
 * The original built a `sh -c` command by `string.Format`-ing the configured
 * host, password, user and database name into
 *
 *   root@{0} "export PGPASSWORD='{1}'; pg_dump -U {2} -d {3} -h localhost"
 *
 * and ran it through a shell. Interpolating the password into a command line
 * leaks it into the process table and into any shell-quoting mistake. Here
 * `pg_dump` is executed directly with the password passed through the
 * environment instead, which needs no shell and no escaping.
 */
export async function dumpDatabase(databaseName: string): Promise<string> {
  const { host, port, user, password } = config.db;

  try {
    const { stdout } = await run(
      config.pgDumpPath,
      [
        '--host', host,
        '--port', String(port),
        '--username', user,
        '--dbname', databaseName,
        // Plain SQL keeps the output self-contained and matches what the
        // original `pg_dump -U .. -d .. -h localhost` produced.
        '--format', 'plain',
        '--no-password',
      ],
      {
        env: { ...process.env, PGPASSWORD: password },
        // A dump can be large; the default 1 MiB cap is far too small.
        maxBuffer: 512 * 1024 * 1024,
      },
    );

    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    // The failure text can contain the connection string, so it is treated as
    // detail rather than being surfaced as the user-facing message.
    throw new AppError('Failed to dump the database.', { details: stderr || String(error) });
  }
}

/** `dbdump{yyyyMMdHmmss}.sql`, matching the legacy `content-disposition` filename. */
export function dumpFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `dbdump${stamp}.sql`;
}
