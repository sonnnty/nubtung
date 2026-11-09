// Keeps the Google Sheet a read-only copy of Postgres: reads sheet_outbox in commit order and sends
// each changed row's current state. Google is only ever called from here, never during a request.
// No `@/` imports here: this module is loaded directly by the node test runner.
//
// The Sheet is addressed by a fresh lookup of ids on every batch, and every change is an upsert or
// delete by id, so a retry after a crash or a timed-out call cannot double a row.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getPool, query } from '../db/index.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { withLedgerLock } from '../db/line-ledger.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { SheetMigrationRequiredError, initTransactionsSchema, readRowsForMirror, readTaxRowsForMirror } from '../db/transactions.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { SHEET_TAX, TAX_HEADERS, TRANSACTIONS_SHEET, transactionToCells } from './cells.ts';

export type Cell = string | number;
export type ValueRender = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

/** The few Google Sheets calls the mirror makes; the real one is in lib/google/sheets.ts */
export interface SheetGateway {
  ensureStructure(): Promise<void>;
  getValues(range: string, render?: ValueRender): Promise<Cell[][]>;
  updateValues(data: Array<{ range: string; values: Cell[][] }>): Promise<void>;
  appendValues(range: string, values: Cell[][]): Promise<void>;
  clearValues(range: string): Promise<void>;
  deleteRows(tab: string, rowNumbers: number[]): Promise<void>;
}

/** Arbitrary but fixed key; only one process mirrors at a time */
const MIRROR_LOCK_KEY = 736402;
/** Keeps one batch to a handful of API calls, well inside Sheets' per-minute quota */
const BATCH_SIZE = 200;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 30 * 60;
/** Changes waiting longer than this are reported as stuck */
const STUCK_AFTER_MINUTES = 15;
const REBUILD_CHUNK_ROWS = 1000;
const TAX_COLUMNS = TAX_HEADERS.length;

let structureEnsured = false;

interface OutboxRow {
  id: string;
  entity: 'transaction' | 'tax_profile';
  entity_id: string;
}

export type MirrorResult =
  | { status: 'not_migrated' | 'waiting' | 'busy' | 'idle' }
  | { status: 'sent'; changes: number }
  | { status: 'failed'; error: string };

function positionsByKey(column: Cell[][], normalize: (value: string) => string): Map<string, number> {
  const rowByKey = new Map<string, number>();
  column.forEach((cells, index) => {
    const key = normalize(String(cells[0] ?? ''));
    // A blank row can never be addressed; the first occurrence of a key wins, as the app's lookups did
    if (key && !rowByKey.has(key)) rowByKey.set(key, index + 2);
  });
  return rowByKey;
}

const padTaxRow = (row: unknown[]): Cell[] =>
  Array.from({ length: TAX_COLUMNS }, (_, i) => (row[i] ?? '') as Cell);

async function applyTransactionChanges(gateway: SheetGateway, ids: string[]): Promise<void> {
  const current = await readRowsForMirror(ids);
  const stillExists = new Set(current.map(tx => tx.id));
  const column = await gateway.getValues(`'${TRANSACTIONS_SHEET}'!I2:I`);
  const rowById = positionsByKey(column, id => id.trim());

  const updates = current.filter(tx => rowById.has(tx.id));
  const appends = current.filter(tx => !rowById.has(tx.id));
  const deletions = ids.filter(id => !stillExists.has(id) && rowById.has(id)).map(id => rowById.get(id)!);

  // Updates before deletions, so the row numbers read above are still right; appends go last, at the bottom
  if (updates.length > 0) {
    await gateway.updateValues(updates.map(tx => {
      const row = rowById.get(tx.id)!;
      return { range: `'${TRANSACTIONS_SHEET}'!A${row}:K${row}`, values: [transactionToCells(tx)] };
    }));
  }
  if (deletions.length > 0) await gateway.deleteRows(TRANSACTIONS_SHEET, deletions);
  if (appends.length > 0) await gateway.appendValues(`'${TRANSACTIONS_SHEET}'!A:K`, appends.map(transactionToCells));
}

async function applyTaxChanges(gateway: SheetGateway, years: number[]): Promise<void> {
  const current = await readTaxRowsForMirror(years);
  const column = await gateway.getValues(`'${SHEET_TAX}'!A2:A`);
  const rowByYear = positionsByKey(column, year => year.replace(/[^\d]/g, ''));

  const updates = current.filter(p => rowByYear.has(String(p.year)));
  const appends = current.filter(p => !rowByYear.has(String(p.year)));
  if (updates.length > 0) {
    await gateway.updateValues(updates.map(p => {
      const row = rowByYear.get(String(p.year))!;
      return { range: `'${SHEET_TAX}'!A${row}:W${row}`, values: [padTaxRow(p.row)] };
    }));
  }
  if (appends.length > 0) await gateway.appendValues(`'${SHEET_TAX}'!A:W`, appends.map(p => padTaxRow(p.row)));
}

export function backoffSeconds(failures: number, retryAfterSeconds?: number): number {
  const delay = Math.min(BASE_BACKOFF_SECONDS * 2 ** Math.max(failures - 1, 0), MAX_BACKOFF_SECONDS);
  return Math.max(delay, retryAfterSeconds ?? 0);
}

function retryAfterSeconds(err: unknown): number | undefined {
  const headers = (err as { response?: { headers?: Record<string, string> } })?.response?.headers;
  const value = headers?.['retry-after'];
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds;
  const until = Date.parse(value);
  return Number.isNaN(until) ? undefined : Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function describeError(err: unknown): string {
  const status = (err as { code?: number | string; response?: { status?: number } })?.response?.status
    ?? (err as { code?: number | string })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return status ? `${status}: ${message}` : message;
}

async function recordSuccess(): Promise<void> {
  await query(
    `UPDATE sheet_mirror_state
     SET last_success_at = CURRENT_TIMESTAMP, last_attempt_at = CURRENT_TIMESTAMP,
         consecutive_failures = 0, next_attempt_at = NULL, last_error = NULL
     WHERE id = 1`,
  );
}

async function recordFailure(err: unknown): Promise<string> {
  const error = describeError(err);
  const res = await query<{ consecutive_failures: number }>(
    `UPDATE sheet_mirror_state
     SET consecutive_failures = consecutive_failures + 1, last_attempt_at = CURRENT_TIMESTAMP, last_error = $1
     WHERE id = 1 RETURNING consecutive_failures`,
    [error],
  );
  const failures = res.rows[0]?.consecutive_failures ?? 1;
  const delay = backoffSeconds(failures, retryAfterSeconds(err));
  await query(`UPDATE sheet_mirror_state SET next_attempt_at = CURRENT_TIMESTAMP + ($1 || ' seconds')::INTERVAL WHERE id = 1`, [delay]);
  console.error(`[Sheet mirror] Sending failed (attempt ${failures}, next try in ${delay}s): ${error}`);
  return error;
}

/**
 * Runs `fn` holding the mirror lock, a session lock on its own connection, so it is released if this
 * process dies. Returns 'busy' when another process has it and waiting is not wanted.
 */
async function withMirrorLock<T>(fn: () => Promise<T>, waitMs = 0): Promise<T | 'busy'> {
  const client = await getPool().connect();
  let healthy = true;
  try {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const res = await client.query<{ got: boolean }>('SELECT pg_try_advisory_lock($1) as got', [MIRROR_LOCK_KEY]);
      if (res.rows[0].got) break;
      if (Date.now() >= deadline) return 'busy';
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIRROR_LOCK_KEY]).catch((err: unknown) => {
        healthy = false;
        console.error('[Sheet mirror] Could not release the mirror lock:', err);
      });
    }
  } finally {
    // A connection that may still hold the lock must not go back to the pool
    client.release(healthy ? undefined : true);
  }
}

async function readMigrationState() {
  await initTransactionsSchema();
  const res = await query<{ migrated_at: string | null; next_attempt_at: string | null }>(
    'SELECT migrated_at, next_attempt_at FROM sheet_mirror_state WHERE id = 1',
  );
  return res.rows[0];
}

/** Sends one batch. Google failures are recorded and returned; Postgres failures propagate. */
export async function mirrorOnce(gateway: SheetGateway): Promise<MirrorResult> {
  const state = await readMigrationState();
  if (!state.migrated_at) return { status: 'not_migrated' };
  const nextAttempt = state.next_attempt_at;
  if (nextAttempt && new Date(nextAttempt).getTime() > Date.now()) return { status: 'waiting' };

  const result = await withMirrorLock(async (): Promise<MirrorResult> => {
    const entries = await query<OutboxRow>('SELECT id, entity, entity_id FROM sheet_outbox ORDER BY id LIMIT $1', [BATCH_SIZE]);
    if (entries.rows.length === 0) return { status: 'idle' };

    try {
      if (!structureEnsured) {
        await gateway.ensureStructure();
        structureEnsured = true;
      }
      // Each change is sent once per batch, in the current state of its row
      const transactionIds = [...new Set(entries.rows.filter(e => e.entity === 'transaction').map(e => e.entity_id))];
      const taxYears = [...new Set(entries.rows.filter(e => e.entity === 'tax_profile').map(e => Number(e.entity_id)))];
      if (transactionIds.length > 0) await applyTransactionChanges(gateway, transactionIds);
      if (taxYears.length > 0) await applyTaxChanges(gateway, taxYears);
    } catch (err) {
      structureEnsured = false;
      return { status: 'failed', error: await recordFailure(err) };
    }

    await query('DELETE FROM sheet_outbox WHERE id = ANY($1::bigint[])', [entries.rows.map(e => e.id)]);
    await recordSuccess();
    return { status: 'sent', changes: entries.rows.length };
  });
  return result === 'busy' ? { status: 'busy' } : result;
}

export interface RebuildReport {
  transactionRows: number;
  taxRows: number;
}

async function overwriteTab(gateway: SheetGateway, tab: string, lastColumn: string, rows: Cell[][]): Promise<void> {
  // In place, then clear what is left below: viewers never see an empty tab, and a crash halfway
  // leaves rows that the next rebuild simply overwrites
  for (let i = 0; i < rows.length; i += REBUILD_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + REBUILD_CHUNK_ROWS);
    const first = i + 2;
    await gateway.updateValues([{ range: `'${tab}'!A${first}:${lastColumn}${first + chunk.length - 1}`, values: chunk }]);
  }
  await gateway.clearValues(`'${tab}'!A${rows.length + 2}:${lastColumn}`);
}

/**
 * Rewrites the transaction and tax tabs from Postgres, for repair. Changes that arrive while it runs
 * stay in the outbox and are applied afterwards. Failures propagate to the caller.
 */
export async function rebuildSheet(gateway: SheetGateway): Promise<RebuildReport> {
  // Before the import Postgres is empty: a rebuild would wipe the Sheet
  const state = await readMigrationState();
  if (!state.migrated_at) throw new SheetMigrationRequiredError();

  const result = await withMirrorLock(async () => {
    // One consistent cut: no write commits between reading the rows and the newest outbox id
    const { rows, taxRows, maxOutboxId } = await withLedgerLock(async () => ({
      rows: await readRowsForMirror(),
      taxRows: await readTaxRowsForMirror(),
      maxOutboxId: (await query<{ max: string | null }>('SELECT max(id) as max FROM sheet_outbox')).rows[0].max,
    }));

    await gateway.ensureStructure();
    await overwriteTab(gateway, TRANSACTIONS_SHEET, 'K', rows.map(transactionToCells));
    await overwriteTab(gateway, SHEET_TAX, 'W', taxRows.map(p => padTaxRow(p.row)));

    if (maxOutboxId) await query('DELETE FROM sheet_outbox WHERE id <= $1', [maxOutboxId]);
    await recordSuccess();
    return { transactionRows: rows.length, taxRows: taxRows.length };
  }, 60_000);

  if (result === 'busy') throw new Error('[Sheet mirror] Another mirror run did not finish within a minute; rebuild not started');
  return result;
}

export interface SheetMirrorHealth {
  state: 'not_migrated' | 'ok' | 'pending' | 'failing' | 'stuck';
  lastMirroredAt: string | null;
  pending: number;
  oldestPendingAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  nextAttemptAt: string | null;
}

export async function getSheetMirrorHealth(): Promise<SheetMirrorHealth> {
  await initTransactionsSchema();
  const res = await query<{
    migrated_at: string | null;
    last_success_at: string | null;
    consecutive_failures: number;
    last_error: string | null;
    next_attempt_at: string | null;
    pending: string;
    oldest: string | null;
    stuck: boolean;
  }>(
    `SELECT s.migrated_at::text, s.last_success_at::text, s.consecutive_failures, s.last_error, s.next_attempt_at::text,
            o.pending, o.oldest::text,
            COALESCE(o.oldest < NOW() - ($1 || ' minutes')::INTERVAL, FALSE) as stuck
     FROM sheet_mirror_state s,
          LATERAL (SELECT count(*) as pending, min(created_at) as oldest FROM sheet_outbox) o
     WHERE s.id = 1`,
    [STUCK_AFTER_MINUTES],
  );
  const row = res.rows[0];
  const pending = Number(row.pending);
  let state: SheetMirrorHealth['state'] = 'ok';
  if (!row.migrated_at) state = 'not_migrated';
  else if (row.stuck) state = 'stuck';
  else if (row.consecutive_failures > 0) state = 'failing';
  else if (pending > 0) state = 'pending';
  return {
    state,
    lastMirroredAt: row.last_success_at,
    pending,
    oldestPendingAt: row.oldest,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
  };
}
