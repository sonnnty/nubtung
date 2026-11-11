// Needs a real Postgres: TEST_DATABASE_URL. See README.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const db = await import('./index.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const ledger = await import('./line-ledger.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const repo = await import('./transactions.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const adjust = await import('./balance-adjustment.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { BALANCE_ADJUSTMENT_CATEGORY } = await import('../balance/balance-adjustment.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const worker = await import('../sheet-mirror/worker.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { FakeSheet, resetDatabase } = await import('../sheet-mirror/fake-sheet.test-helper.ts');
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
const { TRANSACTIONS_SHEET, SHEET_TAX } = await import('../sheet-mirror/cells.ts');
import type { Transaction } from '../../types/index.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';
const HEADER = ['วันที่', 'เวลา', 'ประเภท', 'จำนวนเงิน', 'หมวดหมู่', 'บัญชี', 'รายละเอียด / ร้านค้า', 'สลิป', 'รหัสรายการ', 'Drive File ID', 'ที่มา'];

function tx(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id, date: '2026-11-09', time: '10:00:00', type: 'EXPENSE', amount: 100, category: 'อื่นๆ', account: KPLUS,
    note: `note ${id}`, source: 'MANUAL', createdAt: '2026-11-09T10:00:00', ...over,
  };
}

let cardSeq = 0;
async function addCard(account: string, date: string, time: string, balance: number) {
  cardSeq++;
  await db.query(
    `INSERT INTO line_cards (card_key, account, txn_date, txn_time, direction, amount, balance, title, tx_id)
     VALUES ($1, $2, $3, $4, 'OUT', 1, $5, 'card', 'x')`,
    [`k${cardSeq}`, account, date, time, balance],
  );
}

async function gaps() {
  const state = await adjust.computeLedgerState(await repo.getAllTransactions(), false);
  return state.gaps as Record<string, number | null>;
}

describe('balance adjustment against Postgres', { skip: !url }, () => {
  before(async () => {
    process.env.KPLUS_ACCOUNT_NO = '1183966651';
    process.env.MAKE_ACCOUNT_NO = '1183962996';
    await ledger.initLineLedgerSchema();
    await repo.initTransactionsSchema();
    await db.initStatementBalancesSchema();
  });
  after(async () => { await db.getPool().end(); });

  beforeEach(async () => {
    await resetDatabase();
    await db.query('TRUNCATE statement_balances');
    await db.query(`UPDATE sheet_mirror_state SET migrated_at = NOW() WHERE id = 1`);
    // K PLUS ledger: baseline 43253.07 - 100 = 43153.07
    await repo.appendTransactionRow(tx('a'));
  });

  it('adds one row for the gap, closes it, and a repeat adds nothing', async () => {
    await addCard(KPLUS, '2026-11-10', '14:32:00', 44622.47); // gap -1469.40
    assert.deepEqual((await gaps())[KPLUS], -1469.4);

    const first = await adjust.adjustAccountBalance(KPLUS);
    assert.equal(first.gap, 0);
    assert.deepEqual(
      { ...first.transaction, id: undefined, createdAt: undefined },
      {
        id: undefined, createdAt: undefined, date: '2026-11-10', time: '14:32:00', type: 'INCOME', amount: 1469.4,
        category: BALANCE_ADJUSTMENT_CATEGORY, account: KPLUS, source: 'MANUAL',
        note: 'รายการปรับจำนวนเงิน: ให้ยอดตรงกับธนาคาร (KBank Live 2026-11-10 14:32 ยอด 44,622.47)',
      },
    );
    assert.equal((await gaps())[KPLUS], 0);

    const second = await adjust.adjustAccountBalance(KPLUS);
    assert.deepEqual(second, { transaction: null, gap: 0 });
    const rows = (await repo.getAllTransactions()) as Transaction[];
    assert.equal(rows.filter(r => r.category === BALANCE_ADJUSTMENT_CATEGORY).length, 1);
  });

  it('adds an EXPENSE when the ledger is above the bank', async () => {
    await addCard(MAKE, '2026-11-10', '09:05:00', 3000); // ledger 3672.29 -> gap +672.29
    const res = await adjust.adjustAccountBalance(MAKE);
    assert.equal(res.transaction!.type, 'EXPENSE');
    assert.equal(res.transaction!.amount, 672.29);
    assert.equal((await gaps())[MAKE], 0);
  });

  it('concurrent calls add a single row', async () => {
    await addCard(KPLUS, '2026-11-10', '14:32:00', 44000);
    const results = await Promise.all([adjust.adjustAccountBalance(KPLUS), adjust.adjustAccountBalance(KPLUS)]);
    assert.deepEqual(results.map(r => r.transaction === null).sort(), [false, true]);
    assert.equal(((await repo.getAllTransactions()) as Transaction[]).filter(r => r.category === BALANCE_ADJUSTMENT_CATEGORY).length, 1);
  });

  it('refuses an account without a card or without cards at all, and writes nothing', async () => {
    await assert.rejects(adjust.adjustAccountBalance(KPLUS), { status: 409 });
    await assert.rejects(adjust.adjustAccountBalance('เงินสด'), { status: 400 });
    assert.equal(((await repo.getAllTransactions()) as Transaction[]).length, 1);
  });

  it('rolls back when the row cannot close the gap (card older than the baseline)', async () => {
    await addCard(KPLUS, '2026-08-01', '10:00:00', 50);
    await assert.rejects(adjust.adjustAccountBalance(KPLUS), { status: 409 });
    assert.equal(((await repo.getAllTransactions()) as Transaction[]).length, 1);
    assert.equal((await db.query('SELECT count(*)::int as n FROM sheet_outbox')).rows[0].n, 1);
  });

  it('reaches the Sheet mirror like any other row', async () => {
    await addCard(KPLUS, '2026-11-10', '14:32:00', 44000);
    const sheet = new FakeSheet();
    sheet.seed(TRANSACTIONS_SHEET, [HEADER]);
    sheet.seed(SHEET_TAX, []);
    const { transaction } = await adjust.adjustAccountBalance(KPLUS);
    assert.equal((await worker.mirrorOnce(sheet)).status, 'sent');
    const row = sheet.tabs.get(TRANSACTIONS_SHEET)!.find((r: unknown[]) => r[8] === transaction!.id)!;
    assert.deepEqual([row[2], row[3], row[4], row[5], row[10]], ['🟢 รายรับ', 846.93, BALANCE_ADJUSTMENT_CATEGORY, KPLUS, 'MANUAL']);
  });

  it('is not removed as a duplicate of a real row of the same date, time, amount and account', async () => {
    // A real INCOME of 50 at the card's minute, and a card 100 above the ledger: the adjustment is
    // also an INCOME of 50 at that minute
    await repo.appendTransactionRow(tx('real', { date: '2026-11-10', time: '14:32:00', type: 'INCOME', amount: 50 }));
    await addCard(KPLUS, '2026-11-10', '14:32:00', 43153.07 + 100);
    const { transaction } = await adjust.adjustAccountBalance(KPLUS);
    assert.equal(transaction!.amount, 50);
    const before = (await repo.getAllTransactions()) as Transaction[];
    const res = await repo.deduplicateTransactions();
    assert.equal(res.removedCount, 0);
    assert.equal(((await repo.getAllTransactions()) as Transaction[]).length, before.length);
  });
});
