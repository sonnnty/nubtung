import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { computeAccountBalances, BASELINE_BALANCES } from './account-balances.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseStatement } from '../statement/statement-text.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { planStatementImport } from '../statement/import-plan.ts';
import type { BalanceTransaction } from './account-balances.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';
const PAOTANG = 'เป๋าตัง';
const MAKE_ANCHOR = { account: MAKE, periodEnd: '2026-10-29', closingBalance: 757.83 };

const tx = (date: string, type: BalanceTransaction['type'], amount: number, account: string, note = ''): BalanceTransaction =>
  ({ date, type, amount, account, note });

before(() => {
  process.env.OWN_ACCOUNT_NAMES = 'สมชาย';
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
  delete process.env.PAOTANG_ACCOUNT_NO;
});

describe('computeAccountBalances without anchors (unchanged baseline logic)', () => {
  it('starts from the 2026-09-04 baseline and applies rows from that day on', () => {
    const { balances, asOf } = computeAccountBalances([
      tx('2026-09-03', 'EXPENSE', 999, KPLUS),
      tx('2026-09-04', 'EXPENSE', 53.07, KPLUS),
      tx('2026-09-10', 'INCOME', 100, MAKE),
      tx('2026-09-11', 'TRANSFER', 1000, KPLUS, 'โอนไป X2996'),
      tx('2026-09-12', 'TRANSFER', 300, MAKE, 'โอนไป KTB X9289'),
      tx('2026-09-13', 'TRANSFER', 200, KPLUS, 'โอนระหว่างบัญชี'),
    ]);
    assert.deepStrictEqual(asOf, {});
    assert.strictEqual(balances[KPLUS], 43253.07 - 53.07 - 1000 - 200);
    assert.strictEqual(balances[MAKE], Math.round((3672.29 + 100 + 1000 - 300 + 200) * 100) / 100);
    assert.strictEqual(balances[PAOTANG], Math.round((195.44 + 300) * 100) / 100);
    assert.strictEqual(balances['เงินสด'], 0);
  });
});

describe('computeAccountBalances with statement anchors', () => {
  it('starts an anchored account from the closing balance and only applies later rows', () => {
    const { balances, asOf } = computeAccountBalances([
      tx('2026-10-15', 'EXPENSE', 500, MAKE),
      tx('2026-10-29', 'EXPENSE', 427, MAKE),
      tx('2026-10-30', 'EXPENSE', 32, MAKE),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[MAKE], 725.83);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });
    // other accounts keep the baseline
    assert.strictEqual(balances[KPLUS], BASELINE_BALANCES[KPLUS]);
  });

  it('a transfer before the receiver anchor only affects the sender', () => {
    const { balances } = computeAccountBalances([
      tx('2026-10-08', 'TRANSFER', 1000, KPLUS, 'โอนจาก K PLUS ไปยัง Make by KBank (statement)'),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[KPLUS], 43253.07 - 1000);
    assert.strictEqual(balances[MAKE], 757.83);
  });

  it('a transfer before the sender anchor only affects the receiver', () => {
    const { balances } = computeAccountBalances([
      tx('2026-10-28', 'TRANSFER', 3000, MAKE, 'โอนจาก Make by KBank ไปยัง K PLUS (statement)'),
      tx('2026-10-28', 'TRANSFER', 50, MAKE, 'โอนเงิน: MAKE by KBank โอนไป KTB X9289 สมชาย'),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[MAKE], 757.83);
    assert.strictEqual(balances[KPLUS], 43253.07 + 3000);
    assert.strictEqual(balances[PAOTANG], Math.round((195.44 + 50) * 100) / 100);
  });

  it('a transfer after both anchors moves money between them', () => {
    const { balances } = computeAccountBalances([
      tx('2026-11-01', 'TRANSFER', 100, KPLUS, 'โอนไป X2996'),
      tx('2026-10-31', 'TRANSFER', 200, KPLUS, 'โอนไป X2996'),
    ], [MAKE_ANCHOR, { account: KPLUS, periodEnd: '2026-10-31', closingBalance: 41234.5 }]);
    // 31-10 is covered by the K PLUS statement but not by the Make one
    assert.strictEqual(balances[KPLUS], 41234.5 - 100);
    assert.strictEqual(balances[MAKE], 757.83 + 100 + 200);
  });

  it('ignores anchors older than the baseline and keeps the newest of two', () => {
    const { balances, asOf } = computeAccountBalances([], [
      { account: KPLUS, periodEnd: '2026-08-31', closingBalance: 1 },
      { account: MAKE, periodEnd: '2026-09-30', closingBalance: 2 },
      { account: MAKE, periodEnd: '2026-10-29', closingBalance: 757.83 },
    ]);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });
    assert.strictEqual(balances[KPLUS], 43253.07);
    assert.strictEqual(balances[MAKE], 757.83);
  });
});

describe('Make statement import + anchor, end to end', () => {
  it('Make shows the bank balance (757.83 - the 32 slip of 2026-10-30 = 725.83)', () => {
    const text = readFileSync(new URL('../statement/fixtures/make-statement-2026-10.txt', import.meta.url), 'utf8');
    const parsed = parseStatement(text, 'STM_SA2996_01OCT26_29OCT26.pdf');

    // Before: Make rows from slips only (some deposits missing), plus the slip after the statement
    const sheet = [
      { date: '2026-10-08', amount: 1000, type: 'TRANSFER' as const, account: KPLUS, note: 'โอนระหว่างบัญชี', driveFileId: 'd1' },
      { date: '2026-10-27', amount: 1596, type: 'EXPENSE' as const, account: MAKE, note: 'บาร์บีคิว', driveFileId: 'd2' },
      { date: '2026-10-30', amount: 32, type: 'EXPENSE' as const, account: MAKE, note: 'slip after the statement', driveFileId: 'd3' },
    ];
    const plan = planStatementImport(sheet, [{ account: parsed.account!, transactions: parsed.transactions }]);
    const rows: BalanceTransaction[] = [...sheet, ...plan.toAppend];

    const { balances, asOf } = computeAccountBalances(rows, [{
      account: parsed.account!,
      periodEnd: parsed.header.periodEnd!,
      closingBalance: parsed.header.closingBalance!,
    }]);
    assert.strictEqual(balances[MAKE], 725.83);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });

    // K PLUS (no anchor) loses exactly the five transfers to Make and gains the 3,000 back
    const kplusDelta = Math.round((balances[KPLUS] - 43253.07) * 100) / 100;
    assert.strictEqual(kplusDelta, -(1000 + 750 + 1000 + 200 + 1000) + 3000);
    // เป๋าตัง gains the three Make -> เป๋าตัง transfers
    assert.strictEqual(Math.round((balances[PAOTANG] - 195.44) * 100) / 100, 300 + 170 + 50);
  });
});
