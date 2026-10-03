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
 * caller's insert. It is session-scoped rather than row-scoped because Postgres
 * forbids `FOR UPDATE` on an aggregate query, and it releases automatically if
 * the transaction aborts.
 */

/** Distinct, arbitrary 63-bit key per sequence. */
const WORK_LOCK_KEY = 8_014_022_311_015_001n;
const INVOICE_LOCK_KEY = 8_014_022_311_015_002n;

async function nextFromMax(
  db: Kysely<Database>,
  qualifiedTable: 'domain.work' | 'domain.invoice',
  lockKey: bigint,
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(${lockKey})`.execute(tx);

    const result = await sql<{ next: number | string }>`
      select coalesce(max(number), 0) + 1 as next from ${sql.raw(qualifiedTable)}
    `.execute(tx);

    return Number(result.rows[0]?.next ?? 1);
  });
}

/**
 * Must be called inside the same transaction as the insert that consumes the
 * number, otherwise the advisory lock is released before the row exists.
 */
export function nextWorkNumber(db: Kysely<Database>): Promise<number> {
  return nextFromMax(db, 'domain.work', WORK_LOCK_KEY);
}

export function nextInvoiceNumber(db: Kysely<Database>): Promise<number> {
  return nextFromMax(db, 'domain.invoice', INVOICE_LOCK_KEY);
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
