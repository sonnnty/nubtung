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
const { FakeSheet, resetDatabase, quotaError } = await import('./fake-sheet.test-helper.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { ingestCard, reconcileSlips } = await import('../line/ingest.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { ledgerStore } = await import('../line/store.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { TRANSACTIONS_SHEET, SHEET_TAX } = await import('./cells.ts');
import type { Transaction } from '../../types/index.ts';

const HEADER = ['วันที่', 'เวลา', 'ประเภท', 'จำนวนเงิน', 'หมวดหมู่', 'บัญชี', 'รายละเอียด / ร้านค้า', 'สลิป', 'รหัสรายการ', 'Drive File ID', 'ที่มา'];

function tx(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date: '2026-11-09',
    time: '10:00:00',
    type: 'EXPENSE',
    amount: 100,
    category: 'อื่นๆ',
    account: 'K PLUS',
    note: `note ${id}`,
    source: 'MANUAL',
    createdAt: '2026-11-09T10:00:00',
    ...over,
  };
}

const sheetIds = (sheet: InstanceType<typeof FakeSheet>) =>
  sheet.tabs.get(TRANSACTIONS_SHEET)!.slice(1).map((r: unknown[]) => r[8]);

async function pendingCount() {
  const res = await db.query('SELECT count(*)::int as n FROM sheet_outbox');
  return res.rows[0].n as number;
}

async function freshSheet() {
  await resetDatabase();
  await db.query(`UPDATE sheet_mirror_state SET migrated_at = NOW() WHERE id = 1`);
  const sheet = new FakeSheet();
  sheet.seed(TRANSACTIONS_SHEET, [HEADER]);
  sheet.seed(SHEET_TAX, []);
  return sheet;
}

describe('mirror worker', { skip: !url }, () => {
  before(async () => {
    process.env.KPLUS_ACCOUNT_NO = '1183966651';
    process.env.MAKE_ACCOUNT_NO = '1183962996';
    await ledger.initLineLedgerSchema();
    await repo.initTransactionsSchema();
  });
  after(async () => { await db.getPool().end(); });

  let sheet: InstanceType<typeof FakeSheet>;
  beforeEach(async () => { sheet = await freshSheet(); });

  it('appends, updates and deletes by id, in the columns and format of the Sheet', async () => {
    await repo.appendTransactionRow(tx('a', { slipUrl: 'https://x/a', driveFileId: 'drive_aaaaaaaaaa' }));
    await repo.appendTransactionRow(tx('b', { type: 'INCOME' }));
    await repo.appendTransactionRow(tx('c'));
    assert.deepEqual(await worker.mirrorOnce(sheet), { status: 'sent', changes: 3 });
    const rows = sheet.tabs.get(TRANSACTIONS_SHEET)!;
    assert.deepEqual(rows[1], ['2026-11-09', '10:00:00', '🔴 รายจ่าย', 100, 'อื่นๆ', 'K PLUS', 'note a',
      '=HYPERLINK("https://x/a", "🖼️ ดูสลิป")', 'a', 'drive_aaaaaaaaaa', 'MANUAL']);
    assert.equal(rows[2][2], '🟢 รายรับ');
    assert.equal(rows[2][7], '-');

    await repo.updateTransactionNote('b', 'แก้แล้ว');
    await repo.deleteTransactionRow('a');
    assert.equal((await worker.mirrorOnce(sheet)).status, 'sent');
    assert.deepEqual(sheetIds(sheet), ['b', 'c']);
    assert.equal(sheet.tabs.get(TRANSACTIONS_SHEET)![1][6], 'แก้แล้ว');
    assert.equal(await pendingCount(), 0);
  });

  it('applies a mixed batch in order: row numbers stay right across a deletion', async () => {
    await repo.appendTransactionRow(tx('a'));
    await repo.appendTransactionRow(tx('b'));
    await repo.appendTransactionRow(tx('c'));
    await worker.mirrorOnce(sheet);

    await repo.deleteTransactionRow('a');
    await repo.updateTransactionNote('c', 'c-new');
    await repo.appendTransactionRow(tx('d'));
    await repo.updateTransactionNote('d', 'd-new');
    await repo.appendTransactionRow(tx('e'));
    await repo.deleteTransactionRow('e');
    await worker.mirrorOnce(sheet);

    assert.deepEqual(sheetIds(sheet), ['b', 'c', 'd']);
    const rows = sheet.tabs.get(TRANSACTIONS_SHEET)!;
    assert.equal(rows[2][6], 'c-new');
    assert.equal(rows[3][6], 'd-new');
    assert.equal(rows[1][6], 'note b');
    // e was inserted and deleted before it was ever sent: no append for it
    assert.equal(sheet.calls.filter((c: string) => c.startsWith('append')).pop(), 'append 1');
  });

  it('keeps Sheet order by insertion, regardless of transaction date', async () => {
    await repo.appendTransactionRow(tx('newer', { date: '2026-11-09' }));
    await repo.appendTransactionRow(tx('older', { date: '2026-01-01' }));
    await worker.mirrorOnce(sheet);
    assert.deepEqual(sheetIds(sheet), ['newer', 'older']);
    assert.deepEqual((await repo.getAllTransactions()).map((t: Transaction) => t.id), ['newer', 'older']);
  });

  it('retries with backoff on quota errors, honours Retry-After, and keeps the changes', async () => {
    await repo.appendTransactionRow(tx('a'));
    sheet.failures.push(quotaError('120'));
    const failed = await worker.mirrorOnce(sheet);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /429/);
    assert.equal(await pendingCount(), 1);

    const stateRes = await db.query(`SELECT consecutive_failures, EXTRACT(EPOCH FROM next_attempt_at - NOW()) as wait, last_error FROM sheet_mirror_state`);
    assert.equal(stateRes.rows[0].consecutive_failures, 1);
    assert.ok(Number(stateRes.rows[0].wait) > 100 && Number(stateRes.rows[0].wait) <= 121);

    // Nothing is sent while backing off
    const before = sheet.calls.length;
    assert.deepEqual(await worker.mirrorOnce(sheet), { status: 'waiting' });
    assert.equal(sheet.calls.length, before);

    const health = await worker.getSheetMirrorHealth();
    assert.equal(health.state, 'failing');
    assert.match(health.lastError!, /Quota/);

    await db.query(`UPDATE sheet_mirror_state SET next_attempt_at = NOW() - INTERVAL '1 second'`);
    assert.equal((await worker.mirrorOnce(sheet)).status, 'sent');
    assert.deepEqual(sheetIds(sheet), ['a']);
    const after = await db.query('SELECT consecutive_failures, last_error, next_attempt_at FROM sheet_mirror_state');
    assert.deepEqual(after.rows[0], { consecutive_failures: 0, last_error: null, next_attempt_at: null });
  });

  it('grows the backoff but caps it', () => {
    assert.deepEqual([1, 2, 3, 20].map(worker.backoffSeconds), [30, 60, 120, 1800]);
    assert.equal(worker.backoffSeconds(1, 500), 500);
  });

  it('does not double a row when an append landed but its response was lost', async () => {
    await repo.appendTransactionRow(tx('a'));
    sheet.lostResponses.push(new Error('socket hang up'));
    assert.equal((await worker.mirrorOnce(sheet)).status, 'failed');
    assert.deepEqual(sheetIds(sheet), ['a']);
    assert.equal(await pendingCount(), 1);

    await db.query(`UPDATE sheet_mirror_state SET next_attempt_at = NULL`);
    assert.equal((await worker.mirrorOnce(sheet)).status, 'sent');
    assert.deepEqual(sheetIds(sheet), ['a']);
  });

  it('survives a restart: unsent changes stay in Postgres and go out on the next tick', async () => {
    await repo.appendTransactionRow(tx('a'));
    sheet.failures.push(new Error('outage'));
    await worker.mirrorOnce(sheet);
    await db.query(`UPDATE sheet_mirror_state SET next_attempt_at = NULL`);
    // A new process has no in-memory state at all: only the tables
    assert.equal((await worker.mirrorOnce(new FakeSheet())).status, 'sent');
  });

  it('reports stuck changes and treats a missing row as an insert', async () => {
    await repo.appendTransactionRow(tx('a'));
    await db.query(`UPDATE sheet_outbox SET created_at = NOW() - INTERVAL '20 minutes'`);
    assert.equal((await worker.getSheetMirrorHealth()).state, 'stuck');
    await worker.mirrorOnce(sheet);
    assert.equal((await worker.getSheetMirrorHealth()).state, 'ok');

    sheet.seed(TRANSACTIONS_SHEET, [HEADER]); // someone deleted the row in the Sheet
    await repo.updateTransactionNote('a', 'x');
    await worker.mirrorOnce(sheet);
    assert.deepEqual(sheetIds(sheet), ['a']);
  });

  it('commits a row and its outbox entry together, or neither', async () => {
    await assert.rejects(ledger.withLedgerLock(async () => {
      await repo.appendTransactionRow(tx('a'));
      throw new Error('boom');
    }), /boom/);
    assert.equal((await db.query('SELECT count(*)::int as n FROM transactions')).rows[0].n, 0);
    assert.equal(await pendingCount(), 0);
  });

  it('keeps every row of concurrent writes, on a pool of 10, without deadlock', async () => {
    const writers = Array.from({ length: 60 }, (_, i) => repo.appendTransactionRow(tx(`p${i}`, { time: `10:${String(i % 60).padStart(2, '0')}:00` })));
    await Promise.all(writers);
    const rows = await repo.getAllTransactions();
    assert.equal(rows.length, 60);
    assert.equal(await pendingCount(), 60);
    assert.equal((await worker.mirrorOnce(sheet)).status, 'sent');
    assert.equal(sheetIds(sheet).length, 60);
    assert.equal(new Set(sheetIds(sheet)).size, 60);
  });

  it('runs a burst of concurrent card ingests on the lock\'s own client', async () => {
    const card = (i: number) => ({
      title: 'รายการโอน/ถอน',
      date: '9 พ.ย. 69 21:28 น.',
      account: 'xxx-x-x6665-x',
      amount: `-${(i + 1).toFixed(2)} บาท`,
      balance: `${(10000 - i).toFixed(2)} บาท`,
    });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => ingestCard(card(i), ledgerStore)));
    assert.equal(results.filter((r: { status: string }) => r.status === 'added').length, 30);
    // A retry of the same card adds nothing
    const again = await ingestCard(card(0), ledgerStore);
    assert.equal(again.status, 'duplicate');
    assert.equal((await db.query('SELECT count(*)::int as n FROM transactions')).rows[0].n, 30);
  });

  it('never overwrites a row edited in the web app, and records the edit', async () => {
    const card = {
      title: 'รายการโอน/ถอน',
      date: '9 พ.ย. 69 21:28 น.',
      account: 'xxx-x-x6665-x',
      amount: '-150.00 บาท',
      balance: '13,698.33 บาท',
    };
    const res = await ingestCard(card, ledgerStore);
    await repo.updateTransactionNote(res.txId, 'แก้เอง');
    assert.ok((await repo.getAllTransactions())[0].editedAt);

    await db.query(`INSERT INTO slip_facts (drive_file_id, account, txn_date, txn_time, amount, tx_type, category, note, slip_url)
      VALUES ('s1', 'K PLUS', '2026-11-09', '21:29:10', 150, 'EXPENSE', 'อาหาร', 'สลิป', 'https://x/s1')`);
    const counts = await reconcileSlips(ledgerStore);
    assert.equal(counts.protected, 1);
    const row = (await repo.getAllTransactions())[0];
    assert.equal(row.note, 'แก้เอง');
    assert.equal(row.source, 'LINE');
  });

  it('rebuilds the Sheet from Postgres and leaves later changes in the outbox', async () => {
    await repo.appendTransactionRow(tx('a'));
    await repo.appendTransactionRow(tx('b'));
    await worker.mirrorOnce(sheet);

    // The Sheet was damaged: wrong rows, extra rows below
    sheet.seed(TRANSACTIONS_SHEET, [HEADER, ['junk'], ['junk2'], ['junk3'], ['junk4']]);
    await repo.saveTaxProfile({ totalIncome: 5 } as never, {} as never, 2026, ['x']);
    const report = await worker.rebuildSheet(sheet);
    assert.deepEqual(report, { transactionRows: 2, taxRows: 1 });
    assert.deepEqual(sheetIds(sheet).filter(Boolean), ['a', 'b']);
    assert.equal(sheet.tabs.get(TRANSACTIONS_SHEET)!.slice(3).every((r: unknown[]) => r.every(c => c === '')), true);
    assert.equal(await pendingCount(), 0);
    assert.equal(sheet.tabs.get(SHEET_TAX)![1][0], 2026);
  });

  it('refuses to rebuild before the import has been verified, so it cannot empty the Sheet', async () => {
    await db.query(`UPDATE sheet_mirror_state SET migrated_at = NULL`);
    await assert.rejects(worker.rebuildSheet(sheet), /Google Sheet/);
    assert.deepEqual(sheet.tabs.get(TRANSACTIONS_SHEET), [HEADER]);
  });

  it('propagates a rebuild failure instead of hiding it', async () => {
    await repo.appendTransactionRow(tx('a'));
    sheet.failures.push(new Error('outage'));
    await assert.rejects(worker.rebuildSheet(sheet), /outage/);
    assert.equal(await pendingCount(), 1);
  });

  it('mirrors tax profiles by year, keeping the exclusions when none are sent', async () => {
    await repo.saveTaxProfile({ totalIncome: 1 } as never, { socialSecurity: 9000 } as never, 2026, ['tx1']);
    await repo.saveTaxProfile({ totalIncome: 2 } as never, { socialSecurity: 1000 } as never, 2026);
    await worker.mirrorOnce(sheet);
    const tab = sheet.tabs.get(SHEET_TAX)!;
    assert.equal(tab.length, 1);
    assert.equal(tab[0][1], 2);
    const profile = await repo.getTaxProfile(2026);
    assert.deepEqual(profile.excludedTransactionIds, ['tx1']);
    assert.equal(profile.deductions.socialSecurity, 1000);
  });
});
