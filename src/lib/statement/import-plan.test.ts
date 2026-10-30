import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseStatement } from './statement-text.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { planStatementImport, reconcileStatementRows, statementRowNote, typeLabel } from './import-plan.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { resolveTransferDestination } from '../balance/transfer-destination.ts';
import type { StatementTransaction } from './statement-text.ts';
import type { LedgerRow, PlannedRow, SheetRow, StatementImport } from './import-plan.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';
const PAOTANG = 'เป๋าตัง';

before(() => {
  process.env.OWN_ACCOUNT_NAMES = 'สมชาย';
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
  delete process.env.PAOTANG_ACCOUNT_NO;
});

function makeStatement(): StatementImport {
  const text = readFileSync(new URL('./fixtures/make-statement-2026-10.txt', import.meta.url), 'utf8');
  const parsed = parseStatement(text, 'STM_SA2996_01OCT26_29OCT26.pdf');
  return { account: parsed.account!, transactions: parsed.transactions };
}

/** The K PLUS side of the five K PLUS -> Make transfers in the Make fixture, plus one K PLUS expense */
function kplusStatement(): StatementImport {
  const send = (date: string, time: string, amount: number): StatementTransaction => ({
    date, time, typeDesc: 'โอนเงิน', type: 'TRANSFER', amount, category: 'โอนระหว่างบัญชี', channel: KPLUS,
    details: 'โอนเงิน: K PLUS                 โอนไป X2996 นาย สมชาย ใจดี++', direction: 'OUT', counterparty: MAKE,
  });
  return {
    account: KPLUS,
    transactions: [
      send('2026-10-08', '20:31:00', 1000),
      send('2026-10-13', '22:51:00', 750),
      send('2026-10-23', '16:56:00', 1000),
      send('2026-10-23', '16:59:00', 200),
      send('2026-10-26', '20:35:00', 1000),
      {
        date: '2026-10-13', time: '12:00:00', typeDesc: 'ชำระเงิน', type: 'EXPENSE', amount: 750, category: 'อื่นๆ',
        channel: KPLUS, details: 'ชำระเงิน: K PLUS เพื่อชำระ Ref X1 ร้านค้า', direction: 'OUT', counterparty: null,
      },
    ],
  };
}

const slip = (account: string, date: string, amount: number, type: LedgerRow['type'] = 'EXPENSE'): LedgerRow =>
  ({ account, date, amount, type, driveFileId: `drive_${account}_${date}_${amount}`, source: 'AUTO_SYNC' });
const manual = (account: string, date: string, amount: number, type: LedgerRow['type'] = 'EXPENSE'): LedgerRow =>
  ({ account, date, amount, type, source: 'MANUAL' });
const asLedger = (rows: PlannedRow[]): LedgerRow[] =>
  rows.map(r => ({ account: r.account, date: r.date, amount: r.amount, type: r.type, source: 'STATEMENT' }));
const transfersOf = (rows: PlannedRow[], date: string, amount: number) =>
  rows.filter(r => r.type === 'TRANSFER' && r.date === date && r.amount === amount);

describe('planStatementImport: Make statement into a sheet with slips', () => {
  const sheet: LedgerRow[] = [
    // K PLUS -> Make on 08-10 already has its slip on K PLUS
    slip(KPLUS, '2026-10-08', 1000, 'TRANSFER'),
    // K PLUS -> Make 200 on 23-10 was recorded (wrongly) on Make as a TRANSFER slip
    slip(MAKE, '2026-10-23', 200, 'TRANSFER'),
    // an unrelated K PLUS expense with the same date and amount as the 750 transfer: not the transfer
    manual(KPLUS, '2026-10-13', 750),
    // Make payment slips
    slip(MAKE, '2026-10-28', 427),
    slip(MAKE, '2026-10-01', 90),
    // a K PLUS row with the same date/amount as a Make row must not be taken for it
    slip(KPLUS, '2026-10-07', 139),
  ];

  it('matches slips only on the statement account and adds the rest on Make', () => {
    const plan = planStatementImport(sheet, [makeStatement()]);
    const onMake = plan.toAppend.filter(r => r.account === MAKE);
    assert.ok(!onMake.some(r => r.date === '2026-10-28' && r.amount === 427));
    assert.ok(!onMake.some(r => r.date === '2026-10-01' && r.amount === 90));
    assert.ok(onMake.some(r => r.date === '2026-10-07' && r.amount === 139 && r.type === 'EXPENSE'));
    // the deposits without a slip that made Make drift
    assert.ok(onMake.some(r => r.date === '2026-10-04' && r.amount === 260 && r.type === 'INCOME'));
    assert.ok(onMake.some(r => r.date === '2026-10-10' && r.amount === 389 && r.type === 'INCOME'));
  });

  it('stores receipts from K PLUS once, as a TRANSFER on K PLUS that resolves to Make', () => {
    const plan = planStatementImport(sheet, [makeStatement()]);
    // nothing is ever added on Make for money that came from K PLUS
    const receipts = [['2026-10-08', 1000], ['2026-10-13', 750], ['2026-10-23', 1000], ['2026-10-23', 200], ['2026-10-26', 1000]];
    assert.ok(!plan.toAppend.some(r => r.account === MAKE && receipts.some(([d, a]) => r.date === d && r.amount === a)));
    // 08-10 1000: slip on K PLUS; 23-10 200: slip on Make -> nothing added
    assert.deepStrictEqual(transfersOf(plan.toAppend, '2026-10-08', 1000), []);
    assert.deepStrictEqual(transfersOf(plan.toAppend, '2026-10-23', 200), []);
    // 13-10 750: the K PLUS expense of 750 is not a transfer -> one TRANSFER added on K PLUS
    for (const [date, amount] of [['2026-10-13', 750], ['2026-10-23', 1000], ['2026-10-26', 1000]] as const) {
      const rows = transfersOf(plan.toAppend, date, amount);
      assert.strictEqual(rows.length, 1, `${date} ${amount}`);
      assert.strictEqual(rows[0].account, KPLUS);
      assert.match(rows[0].note, /^โอนจาก K PLUS ไปยัง Make by KBank \(statement\)/);
      assert.strictEqual(resolveTransferDestination(rows[0].note, KPLUS), MAKE);
    }
  });

  it('stores Make -> K PLUS and Make -> เป๋าตัง on Make with notes that resolve correctly', () => {
    const plan = planStatementImport(sheet, [makeStatement()]);
    const toKplus = transfersOf(plan.toAppend, '2026-10-28', 3000);
    assert.strictEqual(toKplus.length, 1);
    assert.strictEqual(toKplus[0].account, MAKE);
    assert.strictEqual(resolveTransferDestination(toKplus[0].note, MAKE), KPLUS);
    const toPaotang = transfersOf(plan.toAppend, '2026-10-01', 300);
    assert.strictEqual(toPaotang.length, 1);
    assert.strictEqual(toPaotang[0].account, MAKE);
    assert.strictEqual(resolveTransferDestination(toPaotang[0].note, MAKE), PAOTANG);
  });

  it('adds nothing when the same statement is imported again', () => {
    const first = planStatementImport(sheet, [makeStatement()]);
    const again = planStatementImport([...sheet, ...asLedger(first.toAppend)], [makeStatement()]);
    assert.deepStrictEqual(again.toAppend, []);
    assert.strictEqual(again.matched, 38);
  });
});

describe('planStatementImport: both sides of K PLUS -> Make', () => {
  const sheet: LedgerRow[] = [manual(KPLUS, '2026-10-13', 750)];
  const kplusMakeTransfers = (rows: LedgerRow[]) =>
    rows.filter(r => r.type === 'TRANSFER' && r.account === KPLUS &&
      ['2026-10-08', '2026-10-13', '2026-10-23', '2026-10-26'].includes(r.date) && [1000, 750, 200].includes(r.amount));

  it('Make first, K PLUS later: the K PLUS statement matches the rows the Make import added', () => {
    const make = planStatementImport(sheet, [makeStatement()]);
    assert.strictEqual(kplusMakeTransfers(asLedger(make.toAppend)).length, 5);
    const kplus = planStatementImport([...sheet, ...asLedger(make.toAppend)], [kplusStatement()]);
    // every transfer was already there, and the 750 expense is the manual row
    assert.deepStrictEqual(kplus.toAppend, []);
    assert.strictEqual(kplus.matched, 6);
  });

  it('K PLUS first, Make later: the Make receipts match the K PLUS rows', () => {
    const kplus = planStatementImport(sheet, [kplusStatement()]);
    assert.strictEqual(kplusMakeTransfers(asLedger(kplus.toAppend)).length, 5);
    const make = planStatementImport([...sheet, ...asLedger(kplus.toAppend)], [makeStatement()]);
    assert.strictEqual(kplusMakeTransfers(asLedger(make.toAppend)).length, 0);
  });

  it('both statements in one run: each transfer is stored once', () => {
    for (const order of [[makeStatement(), kplusStatement()], [kplusStatement(), makeStatement()]]) {
      const plan = planStatementImport(sheet, order);
      const all = [...sheet, ...asLedger(plan.toAppend)];
      assert.strictEqual(kplusMakeTransfers(all).length, 5);
      // and the unrelated K PLUS expense of 750 is still there exactly once
      assert.strictEqual(all.filter(r => r.account === KPLUS && r.type === 'EXPENSE' && r.amount === 750).length, 1);
    }
  });
});

describe('statementRowNote', () => {
  it('keeps K PLUS transfer details as they were (they already resolve)', () => {
    const k = kplusStatement().transactions[0];
    assert.strictEqual(statementRowNote(k), k.details);
    assert.strictEqual(resolveTransferDestination(k.details, KPLUS), MAKE);
  });
});

describe('reconcileStatementRows (Drive path)', () => {
  const row = (date: string, time: string, type: LedgerRow['type'], amount: number, account: string, note: string, slipCell = '-', id = '', fileId = '', source = 'MANUAL'): SheetRow =>
    [date, time, typeLabel(type), amount, 'อื่นๆ', account, note, slipCell, id, fileId, source];

  const existing: SheetRow[] = [
    row('2026-10-08', '20:31:00', 'TRANSFER', 1000, KPLUS, 'โอนระหว่างบัญชี', '🖼️ ดูสลิป', 'tx_slip_1', 'drive_1', 'AUTO_SYNC'),
    row('2026-10-28', '19:03:00', 'EXPENSE', 427, MAKE, 'กูย่างเนื้อ', '🖼️ ดูสลิป', 'tx_slip_2', 'drive_2', 'AUTO_SYNC'),
    row('2026-10-30', '09:00:00', 'EXPENSE', 32, MAKE, 'newer than the statement', '🖼️ ดูสลิป', 'tx_slip_3', 'drive_3', 'AUTO_SYNC'),
    row('2026-10-15', '10:00:00', 'EXPENSE', 50, PAOTANG, 'เป๋าตัง row'),
    row('2026-10-16', '10:00:00', 'EXPENSE', 99, KPLUS, 'K PLUS row'),
  ];

  it('a Make statement rewrites only Make rows; K PLUS only gains the receipts nothing matched', () => {
    const res = reconcileStatementRows(existing, [makeStatement()]);
    const byAccount = (acc: string) => res.rows.filter(r => r[5] === acc);
    // K PLUS: the two original rows unchanged, plus TRANSFERs for 750, 1000 (23-10), 200, 1000 (26-10)
    const kplus = byAccount(KPLUS);
    assert.ok(kplus.some(r => r === existing[0]));
    assert.ok(kplus.some(r => r === existing[4]));
    assert.strictEqual(kplus.length, 2 + 4);
    assert.strictEqual(res.addedTransfers, 4);
    for (const r of kplus.filter(r => r[10] === 'STATEMENT')) {
      assert.strictEqual(resolveTransferDestination(String(r[6]), KPLUS), MAKE);
    }
    // เป๋าตัง untouched
    assert.deepStrictEqual(byAccount(PAOTANG), [existing[3]]);
    // Make: 38 - 5 receipts from K PLUS = 33 statement rows, plus the newer slip kept
    const make = byAccount(MAKE);
    assert.strictEqual(make.length, 33 + 1);
    const matched = make.find(r => r[0] === '2026-10-28' && r[3] === 427)!;
    assert.deepStrictEqual([matched[7], matched[8], matched[9], matched[10]], ['🖼️ ดูสลิป', 'tx_slip_2', 'drive_2', 'AUTO_SYNC+STATEMENT']);
    assert.ok(make.some(r => r === existing[2]));
    assert.deepStrictEqual(res.perAccount, { [MAKE]: { total: 33, matched: 1 } });
  });

  it('is stable when run again on its own output, also with both statements', () => {
    for (const statements of [[makeStatement()], [makeStatement(), kplusStatement()], [kplusStatement(), makeStatement()]]) {
      const first = reconcileStatementRows(existing, statements);
      const second = reconcileStatementRows(first.rows, statements);
      const strip = (rows: SheetRow[]) => rows.map(r => [r[0], r[1], r[2], r[3], r[5], r[6]].join('|')).sort();
      assert.deepStrictEqual(strip(second.rows), strip(first.rows));
      assert.strictEqual(second.addedTransfers, 0);
      const kplusToMake = first.rows.filter(r => r[5] === KPLUS && r[2] === typeLabel('TRANSFER'));
      assert.strictEqual(kplusToMake.length, 5);
    }
  });

  it('a K PLUS statement keeps working as before: K PLUS rows rewritten, others kept', () => {
    const res = reconcileStatementRows(existing, [kplusStatement()]);
    const kplus = res.rows.filter(r => r[5] === KPLUS);
    // 6 statement rows + the unmatched K PLUS row of 16-10
    assert.strictEqual(kplus.length, 7);
    const matched = kplus.find(r => r[0] === '2026-10-08')!;
    assert.deepStrictEqual([matched[8], matched[9], matched[10]], ['tx_slip_1', 'drive_1', 'AUTO_SYNC+STATEMENT']);
    assert.strictEqual(matched[6], kplusStatement().transactions[0].details);
    assert.strictEqual(res.rows.filter(r => r[5] === MAKE).length, 2);
    assert.strictEqual(res.addedTransfers, 0);
  });
});
