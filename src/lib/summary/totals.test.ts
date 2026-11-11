import { describe, it } from 'node:test';
import assert from 'node:assert';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { summarizeTransactions } from './totals.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { BALANCE_ADJUSTMENT_CATEGORY } from '../balance/balance-adjustment.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { categorizeTransactionsForTax } from '../tax/category-mapping.ts';

const rows = [
  { id: 'a', type: 'INCOME' as const, amount: 30000, category: 'เงินเดือน', account: 'K PLUS' },
  { id: 'b', type: 'EXPENSE' as const, amount: 120, category: 'อาหาร', account: 'K PLUS' },
  { id: 'c', type: 'TRANSFER' as const, amount: 500, category: 'โอนระหว่างบัญชี', account: 'K PLUS' },
  { id: 'adj-in', type: 'INCOME' as const, amount: 1469.4, category: BALANCE_ADJUSTMENT_CATEGORY, account: 'K PLUS' },
  { id: 'adj-out', type: 'EXPENSE' as const, amount: 855, category: BALANCE_ADJUSTMENT_CATEGORY, account: 'Make by KBank' },
];

describe('summarizeTransactions', () => {
  it('leaves balance adjustments out of income, expense and the breakdowns', () => {
    const totals = summarizeTransactions(rows);
    assert.strictEqual(totals.totalIncome, 30000);
    assert.strictEqual(totals.totalExpense, 120);
    assert.strictEqual(totals.transferTotal, 500);
    assert.deepStrictEqual(totals.categoryBreakdown, { 'อาหาร': 120 });
    assert.deepStrictEqual(totals.accountBreakdown, { 'K PLUS': 120 });
  });

  it('is unchanged when there are no adjustments', () => {
    assert.deepStrictEqual(summarizeTransactions(rows.slice(0, 3)), summarizeTransactions(rows));
  });
});

describe('tax income', () => {
  it('does not count an income adjustment, even one whose category would map to a tax section', () => {
    const withAdjustment = categorizeTransactionsForTax(rows, []);
    const without = categorizeTransactionsForTax(rows.slice(0, 3), []);
    assert.deepStrictEqual(withAdjustment.syncedIncome, without.syncedIncome);
    assert.deepStrictEqual(withAdjustment.exemptTransactions, without.exemptTransactions);
    const listed = Object.values(withAdjustment.transactionsBySection).flat();
    assert.ok(!listed.some(t => t.id === 'adj-in'));
  });
});
