import { sql, type Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { Database } from '../db/types.js';

/**
 * Sequence numbers, ported from `SequenceNumberProviderFactory`.
 *
 * The .NET implementation computed `MAX(number) + 1` with no locking at all, so
 * two concurrent work orders could be assigned the same number. Two sessions
 * racing here would leave a gap, which is harmless and is how real job systems
 * behave, but a duplicate is not acceptable: the unique constraints on
 * `domain.work.number`, `domain.invoice.number` and `domain.estimate.number`
 * would reject the second write.
 *
 * A transaction-scoped advisory lock is therefore taken around the read and the
 * caller's insert. It is transaction-scoped rather than row-scoped because
 * Postgres forbids `FOR UPDATE` on an aggregate query, and it releases
 * automatically if the transaction aborts.
 *
 * Because `pg_advisory_xact_lock` is released at commit, the number cannot be
 * read on its own and handed to a later insert — the lock would already be
 * gone. The read is therefore exposed only through `withSequence`, which runs
 * the caller's insert inside the very transaction that holds the lock.
 */

/** Distinct, arbitrary 63-bit key per sequence. */
const WORK_LOCK_KEY = 8_014_022_311_015_001n;
const INVOICE_LOCK_KEY = 8_014_022_311_015_002n;

type SequenceName = 'work' | 'invoice';

const LOCK_KEYS: Record<SequenceName, bigint> = {
  work: WORK_LOCK_KEY,
  invoice: INVOICE_LOCK_KEY,
};

const SEQUENCE_TABLES: Record<SequenceName, 'domain.work' | 'domain.invoice'> = {
  work: 'domain.work',
  invoice: 'domain.invoice',
};

/**
 * Runs `use` inside a transaction that holds the advisory lock for `sequence`,
 * with `next` set to the next free number. The callback receives the
 * transaction-scoped `db`, which it must use for the insert that consumes the
 * number — using a different handle would race.
 */
export async function withSequence<T>(
  db: Kysely<Database>,
  sequence: SequenceName,
  use: (next: number, tx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(${LOCK_KEYS[sequence]})`.execute(tx);

    const result = await sql<{ next: number | string }>`
      select coalesce(max(number), 0) + 1 as next from ${sql.raw(SEQUENCE_TABLES[sequence])}
    `.execute(tx);

    return use(Number(result.rows[0]?.next ?? 1), tx);
  });
}

/** `Offer.Issue` numbers an estimate as `{workNumber}-{offerOrderNr}`. */
export function estimateNumber(workNumber: number, offerOrderNr: number): string {
  return `${workNumber}-${offerOrderNr}`;
}

/**
 * Opaque, URL-safe identifier used for demo tenant names.
 *
 * `ShortGuid` in the original produced a 22-character base64url string; the
 * exact byte layout is irrelevant here because the value is only ever used as
 * a database-name suffix, so a shorter random token is used instead.
 */
export function shortGuid(): string {
  return randomBytes(12).toString('base64url');
}
