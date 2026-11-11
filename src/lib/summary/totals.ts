// Income / expense totals and breakdowns over transactions. Balance adjustment rows are not real
// income or spending, so they never count here (they still count in account balances).
// No `@/` imports here: this module is loaded directly by the node test runner.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isBalanceAdjustment } from '../balance/balance-adjustment.ts';

export interface TotalsTransaction {
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  category: string;
  account: string;
}

export interface TransactionTotals {
  totalIncome: number;
  totalExpense: number;
  transferTotal: number;
  /** Expenses per account */
  accountBreakdown: Record<string, number>;
  /** Expenses per category */
  categoryBreakdown: Record<string, number>;
}

export function summarizeTransactions(transactions: TotalsTransaction[]): TransactionTotals {
  const totals: TransactionTotals = {
    totalIncome: 0,
    totalExpense: 0,
    transferTotal: 0,
    accountBreakdown: {},
    categoryBreakdown: {},
  };

  for (const tx of transactions) {
    if (isBalanceAdjustment(tx)) continue;
    const amount = tx.amount || 0;
    if (tx.type === 'INCOME') {
      totals.totalIncome += amount;
    } else if (tx.type === 'EXPENSE') {
      totals.totalExpense += amount;
      totals.categoryBreakdown[tx.category] = (totals.categoryBreakdown[tx.category] || 0) + amount;
      totals.accountBreakdown[tx.account] = (totals.accountBreakdown[tx.account] || 0) + amount;
    } else if (tx.type === 'TRANSFER') {
      totals.transferTotal += amount;
    }
  }
  return totals;
}
