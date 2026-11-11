// Postgres is the source of truth for transactions and tax profiles. Every write here runs in a
// ledger transaction together with its sheet_outbox entry, so the Sheet mirror (see
// lib/sheet-mirror/worker.ts) can never miss a committed change or see one that rolled back.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getPool, inTransaction, query } from './index.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { withLedgerLock } from './line-ledger.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { rowToTaxProfile, taxProfileToRow } from '../sheet-mirror/cells.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isBalanceAdjustment } from '../balance/balance-adjustment.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isLineSourced } from '../statement/import-plan.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { normalizeDateString, normalizeTimeString } from '../utils/date.ts';
import type { Transaction, TransactionType } from '../../types/index.ts';
import type { TaxCalculationResult, TaxDeductions, SavedTaxProfile } from '../tax/tax-types.ts';
import type { DeleteOp, UpdateOp } from '../line/reconcile.ts';

let schemaPromise: Promise<void> | null = null;

export function initTransactionsSchema(): Promise<void> {
  if (!schemaPromise) {
    // On the pool, never a caller's transaction: a rollback must not undo the memoized schema
    schemaPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        sheet_position BIGSERIAL,
        txn_date TEXT NOT NULL,
        txn_time TEXT NOT NULL,
        tx_type VARCHAR(10) NOT NULL,
        amount NUMERIC NOT NULL,
        category TEXT NOT NULL,
        account TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        slip_url TEXT,
        drive_file_id TEXT,
        source TEXT NOT NULL,
        edited_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_newest ON transactions(txn_date DESC, txn_time DESC, sheet_position);
      CREATE INDEX IF NOT EXISTS idx_transactions_sheet_order ON transactions(sheet_position);
      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account, txn_date);
      CREATE INDEX IF NOT EXISTS idx_transactions_drive_file ON transactions(drive_file_id) WHERE drive_file_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS tax_profiles (
        year INTEGER PRIMARY KEY,
        sheet_position BIGSERIAL,
        sheet_row JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sheet_outbox (
        id BIGSERIAL PRIMARY KEY,
        entity VARCHAR(20) NOT NULL,
        entity_id TEXT NOT NULL,
        op VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sheet_mirror_state (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        migrated_at TIMESTAMPTZ,
        migration_report JSONB,
        first_app_write_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        last_error TEXT
      );
      INSERT INTO sheet_mirror_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `).then(() => undefined, (err: unknown) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

export class SheetMigrationRequiredError extends Error {
  constructor() {
    super('ยังไม่ได้ย้ายข้อมูลจาก Google Sheet เข้า Postgres: รัน POST /api/cron/sheet-migrate ก่อนใช้งาน (ดู README)');
    this.name = 'SheetMigrationRequiredError';
  }
}

let migrationVerified = false;

/** Postgres is empty until the import is verified, so nothing may read or write it as the ledger before that */
export async function assertSheetMigrated(): Promise<void> {
  if (migrationVerified) return;
  await initTransactionsSchema();
  const res = await query<{ migrated_at: string | null }>('SELECT migrated_at FROM sheet_mirror_state WHERE id = 1');
  if (!res.rows[0]?.migrated_at) throw new SheetMigrationRequiredError();
  migrationVerified = true;
}

interface OutboxEntry {
  entity: 'transaction' | 'tax_profile';
  entityId: string;
  op: 'insert' | 'update' | 'delete';
}

/** Records Sheet changes; the caller's transaction makes them atomic with the row write */
async function enqueueSheetChanges(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;
  if (!inTransaction()) throw new Error('[DB] Sheet outbox must be written inside the ledger transaction');
  await query(
    `INSERT INTO sheet_outbox (entity, entity_id, op)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])`,
    [entries.map(e => e.entity), entries.map(e => e.entityId), entries.map(e => e.op)],
  );
  // From here on the Sheet is a mirror: the import must not run again (see migrate.ts)
  await query('UPDATE sheet_mirror_state SET first_app_write_at = CURRENT_TIMESTAMP WHERE id = 1 AND first_app_write_at IS NULL');
}

interface TransactionRow {
  id: string;
  date: string;
  time: string;
  type: TransactionType;
  amount: number;
  category: string;
  account: string;
  note: string;
  slipUrl: string | null;
  driveFileId: string | null;
  source: Transaction['source'];
  editedAt: string | null;
}

const COLUMNS = `id, txn_date as date, txn_time as time, tx_type as type, amount::float as amount, category, account,
  note, slip_url as "slipUrl", drive_file_id as "driveFileId", source, edited_at::text as "editedAt"`;

function toTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    date: r.date,
    time: r.time,
    type: r.type,
    amount: r.amount,
    category: r.category,
    account: r.account,
    note: r.note,
    slipUrl: r.slipUrl ?? undefined,
    driveFileId: r.driveFileId ?? undefined,
    source: r.source,
    createdAt: `${r.date}T${r.time}`,
    editedAt: r.editedAt ?? undefined,
  };
}

/** Newest first. Rows with no date stay hidden, as they always were (the import keeps them). */
export async function getAllTransactions(): Promise<Transaction[]> {
  await assertSheetMigrated();
  const res = await query<TransactionRow>(
    `SELECT ${COLUMNS} FROM transactions WHERE txn_date <> ''
     ORDER BY txn_date DESC, txn_time DESC, sheet_position`,
  );
  return res.rows.map(toTransaction);
}

export const getTransactions = getAllTransactions;

/** Writes new rows, skipping slips already recorded and repeats within the batch */
export async function appendTransactionRows(txs: Transaction[]): Promise<void> {
  if (txs.length === 0) return;
  await assertSheetMigrated();

  await withLedgerLock(async () => {
    const existing = await query<{ drive_file_id: string }>(
      'SELECT DISTINCT drive_file_id FROM transactions WHERE drive_file_id = ANY($1)',
      [txs.map(tx => tx.driveFileId?.trim()).filter(Boolean)],
    );
    const existingIds = new Set(existing.rows.map(r => r.drive_file_id));

    const signatures = new Set<string>();
    const accepted: Transaction[] = [];
    for (const tx of txs) {
      if (tx.driveFileId?.trim() && existingIds.has(tx.driveFileId.trim())) {
        console.log(`[Transactions] Slip ${tx.driveFileId} already recorded, skipping.`);
        continue;
      }
      const sig = `${normalizeDateString(tx.date)}|${normalizeTimeString(tx.time)}|${tx.amount}|${tx.account}`;
      // Two equal LINE rows in one minute are two real cards (they differ by balance)
      if (signatures.has(sig) && !isLineSourced(tx.source)) {
        console.log(`[Transactions] Duplicate transaction in batch detected, skipping: ${sig}`);
        continue;
      }
      signatures.add(sig);
      accepted.push(tx);
    }

    const inserted: OutboxEntry[] = [];
    for (const tx of accepted) {
      const res = await query<{ id: string }>(
        `INSERT INTO transactions (id, txn_date, txn_time, tx_type, amount, category, account, note, slip_url, drive_file_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          tx.id,
          normalizeDateString(tx.date),
          normalizeTimeString(tx.time),
          tx.type,
          tx.amount,
          tx.category,
          tx.account,
          tx.note,
          tx.slipUrl ?? null,
          tx.driveFileId ?? null,
          tx.source,
        ],
      );
      if (res.rows.length > 0) inserted.push({ entity: 'transaction', entityId: tx.id, op: 'insert' });
    }
    await enqueueSheetChanges(inserted);
  });
}

export async function appendTransactionRow(tx: Transaction): Promise<void> {
  await appendTransactionRows([tx]);
}

/** Reconciliation's writes. Rows the owner edited and MANUAL rows are refused here as a last guard. */
export async function updateRowsById(ops: UpdateOp[]): Promise<void> {
  if (ops.length === 0) return;
  await withLedgerLock(async () => {
    for (const { row } of ops) {
      const res = await query(
        `UPDATE transactions SET txn_date = $2, txn_time = $3, tx_type = $4, amount = $5, category = $6, account = $7,
           note = $8, slip_url = $9, drive_file_id = $10, source = $11, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND edited_at IS NULL AND source <> 'MANUAL'`,
        [
          row.id,
          normalizeDateString(row.date),
          normalizeTimeString(row.time),
          row.type,
          row.amount,
          row.category,
          row.account,
          row.note,
          row.slipUrl ?? null,
          row.driveFileId ?? null,
          row.source,
        ],
      );
      if (res.rowCount === 0) throw new Error(`Row ${row.id} is gone or protected; not written`);
    }
    await enqueueSheetChanges(ops.map(({ row }) => ({ entity: 'transaction', entityId: row.id, op: 'update' })));
  });
}

export async function deleteRowsById(ops: DeleteOp[]): Promise<void> {
  if (ops.length === 0) return;
  await withLedgerLock(async () => {
    for (const { id } of ops) {
      const res = await query(`DELETE FROM transactions WHERE id = $1 AND edited_at IS NULL AND source <> 'MANUAL'`, [id]);
      if (res.rowCount === 0) throw new Error(`Row ${id} is gone or protected; not deleted`);
    }
    await enqueueSheetChanges(ops.map(({ id }) => ({ entity: 'transaction', entityId: id, op: 'delete' })));
  });
}

/** Deletes a row through the web app; only MANUAL rows unless `onlyManual` is false */
export async function deleteTransactionRow(txId: string, onlyManual: boolean = true): Promise<{ success: boolean; error?: string }> {
  await assertSheetMigrated();
  return withLedgerLock(async () => {
    const id = txId.trim();
    const found = await query<{ source: string }>('SELECT source FROM transactions WHERE id = $1', [id]);
    if (found.rows.length === 0) {
      return { success: false, error: 'ไม่พบรายการที่ต้องการลบ' };
    }
    if (onlyManual && found.rows[0].source.trim() !== 'MANUAL') {
      return { success: false, error: 'สามารถลบได้เฉพาะรายการที่บันทึกด้วยตนเองเท่านั้น' };
    }
    await query('DELETE FROM transactions WHERE id = $1', [id]);
    await enqueueSheetChanges([{ entity: 'transaction', entityId: id, op: 'delete' }]);
    return { success: true };
  });
}

/** Saves an edit made in the web app. The row is then the owner's: reconciliation will not touch it. */
async function recordEdit(id: string, fields: {
  date: string; time: string; type: TransactionType; amount: number; category: string; account: string; note: string;
}): Promise<void> {
  await query(
    `UPDATE transactions SET txn_date = $2, txn_time = $3, tx_type = $4, amount = $5, category = $6, account = $7, note = $8,
       edited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, fields.date, fields.time, fields.type, fields.amount, fields.category, fields.account, fields.note],
  );
  await enqueueSheetChanges([{ entity: 'transaction', entityId: id, op: 'update' }]);
}

async function findRowForEdit(id: string): Promise<TransactionRow | undefined> {
  const res = await query<TransactionRow>(`SELECT ${COLUMNS} FROM transactions WHERE id = $1`, [id]);
  return res.rows[0];
}

export async function updateTransactionNote(txId: string, note: string): Promise<boolean> {
  await assertSheetMigrated();
  return withLedgerLock(async () => {
    const id = txId.trim();
    const row = await findRowForEdit(id);
    if (!row) return false;
    if (row.note !== note) await recordEdit(id, { ...row, note });
    return true;
  });
}

export async function updateManualTransaction(tx: {
  id: string;
  type?: TransactionType;
  amount?: number;
  category?: string;
  account?: string;
  note?: string;
  date?: string;
  time?: string;
}): Promise<{ success: boolean; error?: string }> {
  await assertSheetMigrated();
  return withLedgerLock(async () => {
    const id = tx.id.trim();
    const row = await findRowForEdit(id);
    if (!row) {
      return { success: false, error: 'ไม่พบรายการที่ต้องการแก้ไข' };
    }

    // If not manual and updating more than note, prevent full overwrite
    if (row.source.trim() !== 'MANUAL' && (tx.amount !== undefined || tx.type !== undefined || tx.account !== undefined)) {
      return { success: false, error: 'รายการที่ซิงค์อัตโนมัติสามารถแก้ไขได้เฉพาะรายละเอียด/หมายเหตุเท่านั้น' };
    }

    const next = {
      date: normalizeDateString(tx.date ?? row.date),
      time: normalizeTimeString(tx.time ?? row.time),
      type: tx.type ?? row.type,
      amount: tx.amount ?? row.amount,
      category: tx.category ?? row.category,
      account: tx.account ?? row.account,
      note: tx.note !== undefined ? tx.note : row.note,
    };
    const changed = next.date !== row.date || next.time !== row.time || next.type !== row.type ||
      next.amount !== row.amount || next.category !== row.category || next.account !== row.account || next.note !== row.note;
    if (changed) await recordEdit(id, next);
    return { success: true };
  });
}

/**
 * Removes duplicate rows, oldest row kept: same Drive file, or same date + time + amount + account.
 * Not for LINE rows on the second rule (minute precision; two equal purchases are two real cards),
 * and never a row the owner edited. Balance adjustment rows are left out of the comparison.
 */
export async function deduplicateTransactions(): Promise<{ beforeCount: number; afterCount: number; removedCount: number }> {
  await assertSheetMigrated();
  return withLedgerLock(async () => {
    const res = await query<TransactionRow>(`SELECT ${COLUMNS} FROM transactions ORDER BY sheet_position`);
    const seenDriveFileIds = new Set<string>();
    const seenExact = new Set<string>();
    const duplicates: string[] = [];

    for (const row of res.rows) {
      // Never a duplicate of a real row (even one of the same date, time, amount and account), and
      // never the row a real one is dropped in favour of
      if (isBalanceAdjustment(row)) continue;
      const driveFileId = (row.driveFileId || '').trim();
      let isDuplicate = false;
      if (driveFileId) {
        if (seenDriveFileIds.has(driveFileId)) isDuplicate = true;
        else seenDriveFileIds.add(driveFileId);
      }
      const exactKey = `${row.date}|${row.time}|${row.amount}|${row.account.trim()}`;
      if (!isDuplicate && !isLineSourced(row.source)) {
        if (seenExact.has(exactKey)) isDuplicate = true;
        else seenExact.add(exactKey);
      }
      if (isDuplicate && !row.editedAt) duplicates.push(row.id);
    }

    if (duplicates.length > 0) {
      await query('DELETE FROM transactions WHERE id = ANY($1)', [duplicates]);
      await enqueueSheetChanges(duplicates.map(id => ({ entity: 'transaction', entityId: id, op: 'delete' })));
    }
    return { beforeCount: res.rows.length, afterCount: res.rows.length - duplicates.length, removedCount: duplicates.length };
  });
}

export async function getTaxProfile(year: number): Promise<SavedTaxProfile | null> {
  await assertSheetMigrated();
  const res = await query<{ sheet_row: unknown[] }>('SELECT sheet_row FROM tax_profiles WHERE year = $1', [year]);
  if (res.rows.length === 0) return null;
  return rowToTaxProfile(res.rows[0].sheet_row, year);
}

export async function saveTaxProfile(
  taxResult: TaxCalculationResult,
  deductions: TaxDeductions,
  year: number = new Date().getFullYear(),
  excludedTransactionIds?: string[],
): Promise<void> {
  await assertSheetMigrated();
  await withLedgerLock(async () => {
    const existing = await query<{ sheet_row: unknown[] }>('SELECT sheet_row FROM tax_profiles WHERE year = $1', [year]);
    const previous = existing.rows[0] ? rowToTaxProfile(existing.rows[0].sheet_row, year) : null;
    const ids = excludedTransactionIds ?? previous?.excludedTransactionIds ?? [];
    const row = taxProfileToRow(taxResult, deductions, year, ids);

    await query(
      `INSERT INTO tax_profiles (year, sheet_row) VALUES ($1, $2)
       ON CONFLICT (year) DO UPDATE SET sheet_row = EXCLUDED.sheet_row, updated_at = CURRENT_TIMESTAMP`,
      [year, JSON.stringify(row)],
    );
    await enqueueSheetChanges([{ entity: 'tax_profile', entityId: String(year), op: previous ? 'update' : 'insert' }]);
  });
}

/** Rows the mirror needs, in Sheet order. No date filter: hidden rows are still part of the Sheet. */
export async function readRowsForMirror(ids?: string[]): Promise<Transaction[]> {
  const res = await query<TransactionRow>(
    `SELECT ${COLUMNS} FROM transactions ${ids ? 'WHERE id = ANY($1)' : ''} ORDER BY sheet_position`,
    ids ? [ids] : [],
  );
  return res.rows.map(toTransaction);
}

export async function readTaxRowsForMirror(years?: number[]): Promise<Array<{ year: number; row: unknown[] }>> {
  const res = await query<{ year: number; sheet_row: unknown[] }>(
    `SELECT year, sheet_row FROM tax_profiles ${years ? 'WHERE year = ANY($1)' : ''} ORDER BY sheet_position`,
    years ? [years] : [],
  );
  return res.rows.map(r => ({ year: r.year, row: r.sheet_row }));
}
