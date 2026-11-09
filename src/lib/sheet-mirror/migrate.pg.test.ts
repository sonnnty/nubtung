// Needs a real Postgres: TEST_DATABASE_URL. See README.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const db = await import('../db/index.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const ledger = await import('../db/line-ledger.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const repo = await import('../db/transactions.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const worker = await import('./worker.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { runSheetMigration } = await import('./migrate.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { FakeSheet, resetDatabase } = await import('./fake-sheet.test-helper.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { TRANSACTIONS_SHEET, SHEET_TAX, TAX_HEADERS } = await import('./cells.ts');
import type { Transaction } from '../../types/index.ts';

const HEADER = ['วันที่', 'เวลา', 'ประเภท', 'จำนวนเงิน', 'หมวดหมู่', 'บัญชี', 'รายละเอียด / ร้านค้า', 'สลิป', 'รหัสรายการ', 'Drive File ID', 'ที่มา'];

function row(id: string, over: Partial<Record<string, unknown>> = {}) {
  const r = {
    date: '2026-09-04', time: '09:30:00', type: '🔴 รายจ่าย', amount: 100, category: 'อาหารและเครื่องดื่ม',
    account: 'K PLUS', note: `note ${id}`, slip: '-', id, drive: '', source: 'MANUAL', ...over,
  };
  return [r.date, r.time, r.type, r.amount, r.category, r.account, r.note, r.slip, r.id, r.drive, r.source] as Array<string | number>;
}

const sheetRows = (sheet: InstanceType<typeof FakeSheet>) => sheet.tabs.get(TRANSACTIONS_SHEET)!.slice(1);

describe('sheet import', { skip: !url }, () => {
  before(async () => {
    await db.initSchema();
    await ledger.initLineLedgerSchema();
    await repo.initTransactionsSchema();
    await db.query('CREATE TABLE IF NOT EXISTS line_row_fingerprints (tx_id TEXT PRIMARY KEY, fingerprint TEXT, pending_fingerprint TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())');
  });
  after(async () => { await db.getPool().end(); });

  let sheet: InstanceType<typeof FakeSheet>;
  beforeEach(async () => {
    await resetDatabase();
    await db.query('TRUNCATE line_row_fingerprints');
    sheet = new FakeSheet();
    sheet.seed(TRANSACTIONS_SHEET, [HEADER]);
    sheet.seed(SHEET_TAX, [TAX_HEADERS]);
  });

  it('blocks reads and the worker until the import is verified', async () => {
    await assert.rejects(repo.getAllTransactions(), { name: 'SheetMigrationRequiredError' });
    await assert.rejects(repo.appendTransactionRow({} as Transaction), { name: 'SheetMigrationRequiredError' });
    assert.deepEqual(await worker.mirrorOnce(sheet), { status: 'not_migrated' });
  });

  it('imports every row and verifies count and per-account totals', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [
      HEADER,
      row('a', { amount: 1234.5 }),
      row('b', { type: '🟢 รายรับ', amount: 50000.25, account: 'Make by KBank' }),
      row('c', { slip: '=HYPERLINK("https://drive.google.com/file/d/abc/view?usp=drivesdk", "🖼️ ดูสลิป")', drive: 'abc_long_drive_id', source: 'AUTO_SYNC' }),
    ]);
    const report = await runSheetMigration(sheet);
    assert.equal(report.status, 'migrated');
    assert.equal(report.transactionRows, 3);
    const kplus = report.accounts!.find((a: { account: string }) => a.account === 'K PLUS')!;
    assert.deepEqual([kplus.sheetRows, kplus.postgresRows, kplus.sheetTotal, kplus.postgresTotal], [2, 2, 1334.5, 1334.5]);

    const rows: Transaction[] = await repo.getAllTransactions();
    assert.equal(rows.length, 3);
    const c = rows.find(r => r.id === 'c')!;
    assert.equal(c.slipUrl, 'https://drive.google.com/file/d/abc/view?usp=drivesdk');
    assert.equal(c.driveFileId, 'abc_long_drive_id');
    const processed = await db.query(`SELECT status FROM processed_slips WHERE drive_file_id = 'abc_long_drive_id'`);
    assert.equal(processed.rows[0].status, 'SUCCESS');
  });

  it('reads the real amount when the cell only shows it rounded', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a', { amount: 1234.56 })]);
    sheet.displayOverrides.set('2:3', '1,235');
    const report = await runSheetMigration(sheet);
    assert.equal(report.accounts![0].postgresTotal, 1234.56);
  });

  it('handles odd legacy rows instead of dropping them', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [
      HEADER,
      row('thai-buddhist', { date: '5/1/2569', time: '9:30:00 PM' }),
      row('iso-buddhist', { date: '2569-01-05', time: '13.30 น.' }),
      row('slashes', { date: '4/9/2026', time: '' }),
      row('thai-month', { date: '9 พ.ย. 69', time: '21:28 น.' }),
      row('serial', { date: '45234', time: '-' }),
      row('no-date', { date: '', amount: 77 }),
      row('unreadable', { date: 'เมื่อวาน', time: 'ไม่รู้' }),
      row('baht-string', { amount: '฿1,234.50' }),
      row('bad-amount', { amount: 'ไม่ทราบ' }),
      row('', { note: 'no id here', amount: 11 }),
      [],
      row('after-gap'),
    ]);
    const report = await runSheetMigration(sheet);
    assert.equal(report.transactionRows, 11);
    assert.equal(report.rowsWithoutDate, 1);
    assert.ok(report.warnings!.some((w: string) => w.includes('เมื่อวาน')));
    assert.ok(report.warnings!.some((w: string) => w.includes('ไม่รู้')));

    const res = await db.query('SELECT id, txn_date, txn_time, amount::float, sheet_position FROM transactions ORDER BY sheet_position');
    const byId = new Map(res.rows.map(r => [r.id as string, r]));
    const get = (id: string) => byId.get(id) as { txn_date: string; txn_time: string; amount: number };
    assert.deepEqual([get('thai-buddhist').txn_date, get('thai-buddhist').txn_time], ['2026-01-05', '21:30:00']);
    assert.deepEqual([get('iso-buddhist').txn_date, get('iso-buddhist').txn_time], ['2026-01-05', '13:30:00']);
    assert.equal(get('slashes').txn_date, '2026-09-04');
    assert.deepEqual([get('thai-month').txn_date, get('thai-month').txn_time], ['2026-11-09', '21:28:00']);
    assert.deepEqual([get('serial').txn_date, get('serial').txn_time], ['2023-11-04', '00:00:00']);
    assert.equal(get('unreadable').txn_date, 'เมื่อวาน');
    assert.equal(get('baht-string').amount, 1234.5);
    assert.equal(get('bad-amount').amount, 0);

    // A row without a date is kept and mirrored, but stays out of the app as it always has
    assert.ok(byId.has('no-date'));
    assert.equal((await repo.getAllTransactions()).some((t: Transaction) => t.id === 'no-date'), false);

    // A row without an id gets the app's fallback id, written back so the mirror can find it
    assert.equal(report.idsAssigned, 1);
    assert.ok(byId.has('tx_10'));
    assert.equal(sheetRows(sheet)[9][8], 'tx_10');

    // The blank row does not count; the row after it keeps its order
    assert.deepEqual(res.rows.map(r => r.id).slice(-1), ['after-gap']);
  });

  it('is safe to re-run: same rows, no duplicates, positions kept', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a'), row('b')]);
    await runSheetMigration(sheet);
    const report = await runSheetMigration(sheet);
    assert.equal(report.status, 'migrated');
    const res = await db.query('SELECT id, sheet_position FROM transactions ORDER BY sheet_position');
    assert.deepEqual(res.rows.map(r => r.id), ['a', 'b']);
  });

  it('picks up rows changed or removed in the Sheet on a re-run before go-live', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a', { note: 'old' }), row('b'), row('gone')]);
    await runSheetMigration(sheet);
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a', { note: 'new' }), row('b')]);
    await runSheetMigration(sheet);
    const res = await db.query('SELECT id, note FROM transactions ORDER BY sheet_position');
    assert.deepEqual(res.rows, [{ id: 'a', note: 'new' }, { id: 'b', note: 'note b' }]);
  });

  it('after the app has written, a re-run changes nothing', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a'), row('deleted-later')]);
    await runSheetMigration(sheet);
    await repo.updateTransactionNote('a', 'edited in the app');
    await repo.deleteTransactionRow('deleted-later');

    const report = await runSheetMigration(sheet);
    assert.equal(report.status, 'already_live');
    const res = await db.query('SELECT id, note FROM transactions');
    assert.deepEqual(res.rows, [{ id: 'a', note: 'edited in the app' }]);
  });

  it('stops loudly and rolls back when the Sheet changes during the import', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a')]);
    // The first snapshot takes four reads; the change lands before the verifying read
    const realGet = sheet.getValues.bind(sheet);
    let reads = 0;
    sheet.getValues = async (...args: Parameters<typeof realGet>) => {
      if (++reads === 5) sheet.tabs.get(TRANSACTIONS_SHEET)!.push(row('sneaked-in'));
      return realGet(...args);
    };
    await assert.rejects(runSheetMigration(sheet), { name: 'SheetMigrationError' });
    assert.equal((await db.query('SELECT count(*)::int as n FROM transactions')).rows[0].n, 0);
    assert.equal((await db.query('SELECT migrated_at FROM sheet_mirror_state')).rows[0].migrated_at, null);
  });

  it('stops loudly on duplicate ids', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a'), row('a')]);
    await assert.rejects(runSheetMigration(sheet), /รหัสรายการซ้ำ.*a \(แถว 2, 3\)/);
  });

  it('carries over which LINE rows the owner already edited', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [
      HEADER,
      row('untouched', { source: 'LINE', note: 'LINE: การ์ด', amount: 150, category: 'รอระบุ' }),
      row('edited', { source: 'LINE', note: 'แก้แล้ว', amount: 150, category: 'ช้อปปิ้ง' }),
      row('unknown', { source: 'LINE', note: 'x' }),
    ]);
    await runSheetMigration(sheet);
    await db.query('UPDATE transactions SET edited_at = NULL');
    await db.query(`DELETE FROM sheet_mirror_state; INSERT INTO sheet_mirror_state (id) VALUES (1)`);

    // Fingerprints as the old automation stored them; the stored rows match only 'untouched'
    const { createHash } = await import('node:crypto');
    const fp = (parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex');
    const original = fp(['2026-09-04', '09:30:00', 'EXPENSE', '150.00', 'รอระบุ', 'K PLUS', 'LINE: การ์ด']);
    await db.query(`INSERT INTO line_row_fingerprints (tx_id, fingerprint) VALUES ('untouched', $1), ('edited', $1)`, [original]);

    await runSheetMigration(sheet);
    const res = await db.query('SELECT id, edited_at IS NOT NULL as protected FROM transactions ORDER BY sheet_position');
    assert.deepEqual(res.rows, [
      { id: 'untouched', protected: false },
      { id: 'edited', protected: true },
      { id: 'unknown', protected: true },
    ]);
  });

  it('imports tax profiles and new app rows sort after every imported one', async () => {
    const taxRow = (year: number, income: number) => {
      const cells: Array<string | number> = Array.from({ length: TAX_HEADERS.length }, () => '');
      cells[0] = year;
      cells[2] = income;
      cells[20] = JSON.stringify({ socialSecurity: 9000 });
      cells[22] = '["tx1"]';
      return cells;
    };
    sheet.seed(SHEET_TAX, [TAX_HEADERS, taxRow(2025, 100000), taxRow(2026, 120000)]);
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a'), row('b')]);
    const report = await runSheetMigration(sheet);
    assert.equal(report.taxRows, 2);
    const profile = await repo.getTaxProfile(2026);
    assert.equal(profile!.income.section40_1, 120000);
    assert.deepEqual(profile!.excludedTransactionIds, ['tx1']);
    assert.equal(profile!.deductions.socialSecurity, 9000);

    await repo.appendTransactionRow({ id: 'new', date: '2020-01-01', time: '00:00:00', type: 'EXPENSE', amount: 1, category: 'x', account: 'เงินสด', note: '', source: 'MANUAL', createdAt: '' });
    await worker.mirrorOnce(sheet);
    const rebuilt = await worker.rebuildSheet(sheet);
    assert.deepEqual(rebuilt, { transactionRows: 3, taxRows: 2 });
    assert.deepEqual(sheetRows(sheet).map(r => r[8]), ['a', 'b', 'new']);
    assert.deepEqual(sheet.tabs.get(SHEET_TAX)!.slice(1).map(r => r[0]), ['2025', '2026']);
  });

  it('a rebuild keeps odd legacy rows readable and hidden rows in place', async () => {
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, row('a'), row('no-date', { date: '', amount: 3 }), row('c', { date: '5/1/2569' })]);
    await runSheetMigration(sheet);
    await worker.rebuildSheet(sheet);
    const rows = sheetRows(sheet);
    assert.deepEqual(rows.map(r => r[8]), ['a', 'no-date', 'c']);
    assert.equal(rows[1][0], '');
    assert.equal(rows[2][0], '2026-01-05');
    assert.equal(rows[1][3], 3);
  });
});
