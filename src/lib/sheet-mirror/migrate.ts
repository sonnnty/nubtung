// One-time import of the Google Sheet into Postgres. Safe to re-run: until the app has written
// anything it replaces Postgres with the Sheet by id; after that the Sheet is only a mirror and a
// re-run changes nothing. The whole import is one DB transaction: a failure leaves Postgres as it was.
// No `@/` imports here: this module is loaded directly by the node test runner.
import { createHash } from 'node:crypto';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { initSchema, query } from '../db/index.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { initLineLedgerSchema, withLedgerLock } from '../db/line-ledger.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { initTransactionsSchema } from '../db/transactions.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isLineSourced } from '../statement/import-plan.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isIsoDateString, normalizeDateString, normalizeTimeString } from '../utils/date.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { SHEET_TAX, TAX_HEADERS, TRANSACTIONS_SHEET } from './cells.ts';
import type { TransactionType } from '../../types/index.ts';
import type { Cell, SheetGateway } from './worker.ts';

export class SheetMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetMigrationError';
  }
}

interface ImportRow {
  sheetRow: number;
  id: string;
  /** The Sheet had no id on this row: the import assigned one and writes it back */
  idAssigned: boolean;
  date: string;
  time: string;
  type: TransactionType;
  amount: number;
  category: string;
  account: string;
  note: string;
  slipUrl: string | null;
  driveFileId: string | null;
  source: string;
}

interface ImportTaxRow {
  sheetRow: number;
  year: number;
  cells: Cell[];
}

interface SheetSnapshot {
  rows: ImportRow[];
  taxRows: ImportTaxRow[];
  warnings: string[];
}

export interface AccountCheck {
  account: string;
  sheetRows: number;
  postgresRows: number;
  sheetTotal: number;
  postgresTotal: number;
}

export interface MigrationReport {
  status: 'migrated' | 'already_live';
  message: string;
  transactionRows?: number;
  taxRows?: number;
  accounts?: AccountCheck[];
  idsAssigned?: number;
  rowsWithoutDate?: number;
  protectedRows?: number;
  warnings?: string[];
}

const BATCH = 500;
const text = (cell: Cell | undefined) => String(cell ?? '').trim();

function parseAmount(formatted: Cell | undefined, unformatted: Cell | undefined): number {
  if (typeof unformatted === 'number') return unformatted;
  const clean = String(unformatted ?? formatted ?? '').replace(/[^\d.-]/g, '');
  return parseFloat(clean) || 0;
}

function parseType(raw: string): TransactionType {
  if (raw.includes('รายรับ') || raw === 'INCOME') return 'INCOME';
  if (raw.includes('โอนย้าย') || raw === 'TRANSFER') return 'TRANSFER';
  return 'EXPENSE';
}

function slipUrlOf(displayed: string, formula: string, driveFileId: string): string | null {
  // The cell shows "🖼️ ดูสลิป"; the link is only in the formula
  const fromFormula = formula.match(/^=HYPERLINK\("([^"]+)"/i)?.[1];
  if (fromFormula) return fromFormula;
  if (displayed.startsWith('http')) return displayed;
  if (driveFileId.length > 10) return `https://drive.google.com/file/d/${driveFileId}/view`;
  return null;
}

async function readSnapshot(gateway: SheetGateway): Promise<SheetSnapshot> {
  // Formatted values are what the app has always read; the amount and the link need their own views
  const display = await gateway.getValues(`'${TRANSACTIONS_SHEET}'!A2:K`, 'FORMATTED_VALUE');
  const amounts = await gateway.getValues(`'${TRANSACTIONS_SHEET}'!D2:D`, 'UNFORMATTED_VALUE');
  const formulas = await gateway.getValues(`'${TRANSACTIONS_SHEET}'!H2:H`, 'FORMULA');
  const tax = await gateway.getValues(`'${SHEET_TAX}'!A2:W`, 'FORMATTED_VALUE');

  const warnings: string[] = [];
  const rows: ImportRow[] = [];

  display.forEach((cells, index) => {
    if (cells.every(c => text(c) === '')) return; // a blank row is no row
    const sheetRow = index + 2;
    const rawId = text(cells[8]);
    const driveFileId = text(cells[9]);
    const date = normalizeDateString(text(cells[0]));
    const rawTime = text(cells[1]);
    const time = normalizeTimeString(rawTime);

    if (date && !isIsoDateString(date)) warnings.push(`แถว ${sheetRow}: อ่านวันที่ "${date}" ไม่ได้ เก็บตามเดิม`);
    if (!date) warnings.push(`แถว ${sheetRow}: ไม่มีวันที่ เก็บไว้แต่ซ่อนจากแอปเหมือนเดิม`);
    if (rawTime && time === '00:00:00' && !/^0*:?0*:?0*\s*(น\.?)?$/.test(rawTime)) {
      warnings.push(`แถว ${sheetRow}: อ่านเวลา "${rawTime}" ไม่ได้ ใช้ 00:00:00`);
    }

    rows.push({
      sheetRow,
      id: rawId || `tx_${index + 1}`,
      idAssigned: !rawId,
      date,
      time,
      type: parseType(text(cells[2])),
      amount: parseAmount(cells[3], amounts[index]?.[0]),
      category: text(cells[4]) || 'อื่นๆ',
      account: text(cells[5]) || 'ไม่ระบุ',
      note: String(cells[6] ?? ''),
      slipUrl: slipUrlOf(text(cells[7]), text(formulas[index]?.[0]), driveFileId),
      driveFileId: driveFileId || null,
      source: text(cells[10]) || 'MANUAL',
    });
  });

  const duplicates = findDuplicates(rows.map(r => ({ key: r.id, row: r.sheetRow })));
  if (duplicates.length > 0) {
    throw new SheetMigrationError(`พบรหัสรายการซ้ำใน Sheet: ${duplicates.join('; ')} — แก้รหัสในแถวเหล่านี้ให้ไม่ซ้ำแล้วรันใหม่`);
  }

  const taxRows: ImportTaxRow[] = [];
  tax.forEach((cells, index) => {
    if (cells.every(c => text(c) === '')) return;
    const sheetRow = index + 2;
    const year = parseInt(text(cells[0]).replace(/[^\d]/g, ''), 10);
    if (isNaN(year)) {
      throw new SheetMigrationError(`แท็บภาษี แถว ${sheetRow}: อ่านปีภาษี "${text(cells[0])}" ไม่ได้ — แก้แล้วรันใหม่`);
    }
    taxRows.push({ sheetRow, year, cells: Array.from({ length: TAX_HEADERS.length }, (_, i) => cells[i] ?? '') });
  });
  const duplicateYears = findDuplicates(taxRows.map(r => ({ key: String(r.year), row: r.sheetRow })));
  if (duplicateYears.length > 0) {
    throw new SheetMigrationError(`พบปีภาษีซ้ำในแท็บภาษี: ${duplicateYears.join('; ')} — รวมเหลือแถวเดียวแล้วรันใหม่`);
  }

  return { rows, taxRows, warnings };
}

function findDuplicates(entries: Array<{ key: string; row: number }>): string[] {
  const rowsByKey = new Map<string, number[]>();
  for (const { key, row } of entries) rowsByKey.set(key, [...(rowsByKey.get(key) || []), row]);
  return [...rowsByKey].filter(([, rows]) => rows.length > 1).map(([key, rows]) => `${key} (แถว ${rows.join(', ')})`);
}

function legacyFingerprint(row: ImportRow): string {
  return createHash('sha1').update([
    row.date,
    row.time,
    row.type,
    row.amount.toFixed(2),
    row.category.trim(),
    row.account.trim(),
    row.note.replace(/\s+/g, ' ').trim(),
  ].join('|')).digest('hex');
}

/**
 * LINE rows the old fingerprint check treated as the owner's: a row matching what the automation
 * last wrote stays open; one that differs, or was never recorded, keeps its protection.
 */
async function protectedRowIds(rows: ImportRow[]): Promise<Set<string>> {
  const table = await query<{ exists: boolean }>(`SELECT to_regclass('line_row_fingerprints') IS NOT NULL as exists`);
  const lineRows = rows.filter(r => isLineSourced(r.source));
  if (!table.rows[0].exists) return new Set();

  const res = await query<{ tx_id: string; fingerprint: string | null; pending_fingerprint: string | null }>(
    'SELECT tx_id, fingerprint, pending_fingerprint FROM line_row_fingerprints',
  );
  const stored = new Map(res.rows.map(r => [r.tx_id, r]));
  const protectedIds = new Set<string>();
  for (const row of lineRows) {
    const known = stored.get(row.id);
    const current = legacyFingerprint(row);
    if (!known || (current !== known.fingerprint && current !== known.pending_fingerprint)) protectedIds.add(row.id);
  }
  return protectedIds;
}

async function writeImport(snapshot: SheetSnapshot, protectedIds: Set<string>): Promise<void> {
  const ids = snapshot.rows.map(r => r.id);
  await query('DELETE FROM transactions WHERE NOT (id = ANY($1::text[]))', [ids]);

  for (let i = 0; i < snapshot.rows.length; i += BATCH) {
    const batch = snapshot.rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders = batch.map((r, b) => {
      values.push(r.id, r.sheetRow, r.date, r.time, r.type, r.amount, r.category, r.account, r.note, r.slipUrl, r.driveFileId, r.source, protectedIds.has(r.id));
      const at = b * 13;
      const p = (n: number) => `$${at + n}`;
      return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, CASE WHEN ${p(13)}::boolean THEN CURRENT_TIMESTAMP END)`;
    }).join(', ');
    await query(
      `INSERT INTO transactions (id, sheet_position, txn_date, txn_time, tx_type, amount, category, account, note, slip_url, drive_file_id, source, edited_at)
       VALUES ${placeholders}
       ON CONFLICT (id) DO UPDATE SET
         sheet_position = EXCLUDED.sheet_position, txn_date = EXCLUDED.txn_date, txn_time = EXCLUDED.txn_time,
         tx_type = EXCLUDED.tx_type, amount = EXCLUDED.amount, category = EXCLUDED.category, account = EXCLUDED.account,
         note = EXCLUDED.note, slip_url = EXCLUDED.slip_url, drive_file_id = EXCLUDED.drive_file_id,
         source = EXCLUDED.source, edited_at = EXCLUDED.edited_at, updated_at = CURRENT_TIMESTAMP`,
      values,
    );
  }

  await query('DELETE FROM tax_profiles WHERE NOT (year = ANY($1::int[]))', [snapshot.taxRows.map(r => r.year)]);
  for (const r of snapshot.taxRows) {
    await query(
      `INSERT INTO tax_profiles (year, sheet_position, sheet_row) VALUES ($1, $2, $3)
       ON CONFLICT (year) DO UPDATE SET sheet_position = EXCLUDED.sheet_position, sheet_row = EXCLUDED.sheet_row, updated_at = CURRENT_TIMESTAMP`,
      [r.year, r.sheetRow, JSON.stringify(r.cells)],
    );
  }

  // New rows must sort after every imported one
  await query(
    `SELECT setval(pg_get_serial_sequence('transactions', 'sheet_position'), GREATEST((SELECT COALESCE(max(sheet_position), 1) FROM transactions), 1)),
            setval(pg_get_serial_sequence('tax_profiles', 'sheet_position'), GREATEST((SELECT COALESCE(max(sheet_position), 1) FROM tax_profiles), 1))`,
  );

  // Slips already in the Sheet must not be read again after the move
  await query(
    `INSERT INTO processed_slips (drive_file_id, account, status)
     SELECT DISTINCT trim(drive_file_id), 'SHEET_SYNC', 'SUCCESS' FROM transactions
     WHERE drive_file_id IS NOT NULL AND trim(drive_file_id) <> ''
     ON CONFLICT (drive_file_id) DO NOTHING`,
  );
}

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Compares what Postgres now holds with a fresh read of the Sheet. Throws on any difference. */
async function verify(gateway: SheetGateway, imported: SheetSnapshot): Promise<AccountCheck[]> {
  const current = await readSnapshot(gateway);
  const problems: string[] = [];

  if (current.rows.length !== imported.rows.length) {
    problems.push(`Sheet เปลี่ยนระหว่างย้าย: ${imported.rows.length} แถวตอนเริ่ม, ${current.rows.length} แถวตอนตรวจ (หยุดแอปเดิมก่อน)`);
  }

  const totals = await query<{ account: string; rows: number; total: number }>(
    `SELECT account, count(*)::int as rows, COALESCE(sum(amount), 0)::float as total FROM transactions GROUP BY account`,
  );
  const postgres = new Map(totals.rows.map(r => [r.account, r]));
  const postgresCount = totals.rows.reduce((sum, r) => sum + r.rows, 0);
  if (postgresCount !== current.rows.length) {
    problems.push(`จำนวนแถวไม่ตรง: Sheet ${current.rows.length}, Postgres ${postgresCount}`);
  }

  const sheetAccounts = new Map<string, { rows: number; total: number }>();
  for (const row of current.rows) {
    const entry = sheetAccounts.get(row.account) || { rows: 0, total: 0 };
    entry.rows++;
    entry.total += row.amount;
    sheetAccounts.set(row.account, entry);
  }

  const accounts: AccountCheck[] = [];
  for (const account of new Set([...sheetAccounts.keys(), ...postgres.keys()])) {
    const sheet = sheetAccounts.get(account) || { rows: 0, total: 0 };
    const db = postgres.get(account) || { rows: 0, total: 0 };
    accounts.push({ account, sheetRows: sheet.rows, postgresRows: db.rows, sheetTotal: sheet.total, postgresTotal: db.total });
    if (sheet.rows !== db.rows || !sameMoney(sheet.total, db.total)) {
      problems.push(`ยอดบัญชี ${account} ไม่ตรง: Sheet ${sheet.rows} แถว ${sheet.total}, Postgres ${db.rows} แถว ${db.total}`);
    }
  }

  const postgresIds = await query<{ id: string }>('SELECT id FROM transactions');
  const known = new Set(postgresIds.rows.map(r => r.id));
  const missing = current.rows.filter(r => !known.has(r.id)).map(r => r.id);
  if (missing.length > 0) problems.push(`ไม่พบรหัสใน Postgres: ${missing.slice(0, 20).join(', ')}`);

  const taxCount = await query<{ n: number }>('SELECT count(*)::int as n FROM tax_profiles');
  if (taxCount.rows[0].n !== current.taxRows.length) {
    problems.push(`จำนวนโปรไฟล์ภาษีไม่ตรง: Sheet ${current.taxRows.length}, Postgres ${taxCount.rows[0].n}`);
  }

  if (problems.length > 0) throw new SheetMigrationError(`ตรวจสอบการย้ายข้อมูลไม่ผ่าน: ${problems.join(' | ')}`);
  return accounts;
}

export async function runSheetMigration(gateway: SheetGateway): Promise<MigrationReport> {
  await initSchema();
  await initLineLedgerSchema();
  await initTransactionsSchema();

  const alreadyLive = async () => {
    const state = await query<{ first_app_write_at: string | null }>('SELECT first_app_write_at FROM sheet_mirror_state WHERE id = 1');
    return state.rows[0].first_app_write_at !== null;
  };
  const liveMessage: MigrationReport = {
    status: 'already_live',
    message: 'แอปเขียนลง Postgres แล้ว Sheet เป็นเพียงสำเนา จึงไม่นำเข้าซ้ำ (ไม่มีการเปลี่ยนแปลง)',
  };
  if (await alreadyLive()) return liveMessage;

  // Read outside the lock so Google's latency is not spent holding it
  const snapshot = await readSnapshot(gateway);

  return withLedgerLock(async () => {
    if (await alreadyLive()) return liveMessage;

    const protectedIds = await protectedRowIds(snapshot.rows);
    await writeImport(snapshot, protectedIds);
    const accounts = await verify(gateway, snapshot);

    // Mirror rows are found by id, so rows that had none get theirs written back
    const assigned = snapshot.rows.filter(r => r.idAssigned);
    if (assigned.length > 0) {
      await gateway.updateValues(assigned.map(r => ({ range: `'${TRANSACTIONS_SHEET}'!I${r.sheetRow}:I${r.sheetRow}`, values: [[r.id]] })));
    }

    const report: MigrationReport = {
      status: 'migrated',
      message: `ย้ายข้อมูลสำเร็จ: ${snapshot.rows.length} รายการ, โปรไฟล์ภาษี ${snapshot.taxRows.length} ปี`,
      transactionRows: snapshot.rows.length,
      taxRows: snapshot.taxRows.length,
      accounts,
      idsAssigned: assigned.length,
      rowsWithoutDate: snapshot.rows.filter(r => !r.date).length,
      protectedRows: protectedIds.size,
      warnings: snapshot.warnings,
    };

    await query(
      `UPDATE sheet_mirror_state SET migrated_at = CURRENT_TIMESTAMP, migration_report = $1,
         last_success_at = CURRENT_TIMESTAMP, consecutive_failures = 0, next_attempt_at = NULL, last_error = NULL
       WHERE id = 1`,
      [JSON.stringify(report)],
    );
    return report;
  });
}
