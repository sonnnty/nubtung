// Dashboard account balances: a starting balance per account plus every transaction after it.
// No `@/` imports here: this module is loaded directly by the node test runner.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { resolveTransferDestination } from './transfer-destination.ts';

/** Verified baseline balances, at the start of BASELINE_DATE */
export const BASELINE_DATE = '2026-09-04';
export const BASELINE_BALANCES: Record<string, number> = {
  'K PLUS': 43253.07,
  'Make by KBank': 3672.29,
  'เป๋าตัง': 195.44,
  'เงินสด': 0.00,
};

/** Closing balance of the newest imported e-statement of an account, at the end of periodEnd */
export interface BalanceAnchor {
  account: string;
  periodEnd: string;
  closingBalance: number;
}

export interface BalanceTransaction {
  date: string;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  account: string;
  note?: string;
}

export interface AccountBalances {
  balances: Record<string, number>;
  /** Accounts whose balance starts from a statement closing balance -> that statement's period end */
  asOf: Record<string, string>;
}

/**
 * Accounts with a statement anchor newer than the baseline start from the statement's closing
 * balance and only count transactions dated after its period end; the others start from the
 * baseline and count transactions from BASELINE_DATE on. A TRANSFER moves money out of its row's
 * account and into the account its note names, and each side only counts if that side's own
 * account counts the date (a transfer the receiver's statement already includes only affects the
 * sender, and the other way round).
 */
export function computeAccountBalances(
  transactions: BalanceTransaction[],
  anchors: BalanceAnchor[] = [],
  baseline: Record<string, number> = BASELINE_BALANCES,
  baselineDate: string = BASELINE_DATE,
): AccountBalances {
  const balances: Record<string, number> = { ...baseline };
  const asOf: Record<string, string> = {};

  for (const anchor of anchors) {
    // The baseline is the balance at the start of its day, a statement's at the end of its last day
    if (anchor.periodEnd >= baselineDate && (!asOf[anchor.account] || anchor.periodEnd > asOf[anchor.account])) {
      balances[anchor.account] = anchor.closingBalance;
      asOf[anchor.account] = anchor.periodEnd;
    }
  }

  const counts = (account: string, date: string) =>
    asOf[account] ? date > asOf[account] : date >= baselineDate;
  const add = (account: string, amount: number) => {
    balances[account] = (balances[account] || 0) + amount;
  };

  for (const tx of transactions) {
    const acc = tx.account || 'เงินสด';
    const fromCounts = counts(acc, tx.date);
    if (fromCounts && balances[acc] === undefined) balances[acc] = 0;

    if (tx.type === 'INCOME') {
      if (fromCounts) add(acc, tx.amount);
    } else if (tx.type === 'EXPENSE') {
      if (fromCounts) add(acc, -tx.amount);
    } else if (tx.type === 'TRANSFER') {
      if (fromCounts) add(acc, -tx.amount);
      const toAcc = resolveTransferDestination(tx.note, acc);
      if (toAcc && counts(toAcc, tx.date)) add(toAcc, tx.amount);
    }
  }

  for (const acc of Object.keys(balances)) {
    balances[acc] = Math.round(balances[acc] * 100) / 100;
  }

  return { balances, asOf };
}
