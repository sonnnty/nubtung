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

/** Accounts whose real balance comes from LINE "KBank Live" cards */
export const CARD_ACCOUNTS = ['K PLUS', 'Make by KBank'] as const;

/** Closing balance of the newest imported e-statement of an account, at the end of periodEnd */
export interface BalanceAnchor {
  account: string;
  periodEnd: string;
  closingBalance: number;
}

/** Upper cutoff (inclusive, at minute precision) for counting an account's transactions */
export interface BalanceCutoff {
  date: string;
  time: string;
}

/** Balance snapshot from a LINE "KBank Live" card */
export interface BalanceCard {
  account: string;
  date: string;
  time: string;
  balance: number;
  seq: number;
}

export interface BalanceTransaction {
  date: string;
  time?: string;
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

export interface AccountBalancesWithCards extends AccountBalances {
  /** Ledger balance per account (cut off at the newest card's date and time when the account has a card) */
  ledgerBalances: Record<string, number>;
  /** ledgerBalance - cardBalance (rounded to 2 decimals) for K PLUS and Make; null when an account has no card yet */
  gaps: Record<string, number | null>;
  /** When the newest card was read from the chat ("YYYY-MM-DD HH:mm"), or null when an account has no card yet */
  cardTimes: Record<string, string | null>;
  /** Total cash across all accounts, using card balances where available and ledger balances elsewhere */
  totalCash: number;
}

export function minuteKey(time: string | undefined): string {
  if (!time) return '00:00';
  const m = time.trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '00:00';
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Accounts with a statement anchor newer than the baseline (and before the account's cutoff, if any)
 * start from the statement's closing balance and only count transactions dated after its period end;
 * the others start from the baseline and count transactions from BASELINE_DATE on. When a cutoff is
 * given for an account, only transactions up to that date and minute (inclusive) count for it. A
 * TRANSFER moves money out of its row's account and into the account its note names, and each side
 * only counts if that side's own account counts the row's date and time.
 */
export function computeAccountBalances(
  transactions: BalanceTransaction[],
  anchors: BalanceAnchor[] = [],
  baseline: Record<string, number> = BASELINE_BALANCES,
  baselineDate: string = BASELINE_DATE,
  cutoffs: Record<string, BalanceCutoff> = {},
): AccountBalances {
  const balances: Record<string, number> = { ...baseline };
  const asOf: Record<string, string> = {};

  for (const anchor of anchors) {
    const cutoff = cutoffs[anchor.account];
    // The baseline is the balance at the start of its day, a statement's at the end of its last day
    if (
      anchor.periodEnd >= baselineDate &&
      (!cutoff || anchor.periodEnd < cutoff.date) &&
      (!asOf[anchor.account] || anchor.periodEnd > asOf[anchor.account])
    ) {
      balances[anchor.account] = anchor.closingBalance;
      asOf[anchor.account] = anchor.periodEnd;
    }
  }

  const counts = (account: string, date: string, time?: string) => {
    const afterStart = asOf[account] ? date > asOf[account] : date >= baselineDate;
    if (!afterStart) return false;
    const cutoff = cutoffs[account];
    if (!cutoff) return true;
    if (date !== cutoff.date) return date < cutoff.date;
    return minuteKey(time) <= minuteKey(cutoff.time);
  };
  const add = (account: string, amount: number) => {
    balances[account] = (balances[account] || 0) + amount;
  };

  for (const tx of transactions) {
    const acc = tx.account || 'เงินสด';
    const fromCounts = counts(acc, tx.date, tx.time);
    if (fromCounts && balances[acc] === undefined) balances[acc] = 0;

    if (tx.type === 'INCOME') {
      if (fromCounts) add(acc, tx.amount);
    } else if (tx.type === 'EXPENSE') {
      if (fromCounts) add(acc, -tx.amount);
    } else if (tx.type === 'TRANSFER') {
      if (fromCounts) add(acc, -tx.amount);
      const toAcc = resolveTransferDestination(tx.note, acc);
      if (toAcc && counts(toAcc, tx.date, tx.time)) add(toAcc, tx.amount);
    }
  }

  for (const acc of Object.keys(balances)) {
    balances[acc] = round2(balances[acc]);
  }

  return { balances, asOf };
}

function compareCards(a: BalanceCard, b: BalanceCard): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const minA = minuteKey(a.time);
  const minB = minuteKey(b.time);
  if (minA !== minB) return minA < minB ? -1 : 1;
  return a.seq - b.seq;
}

/** Picks each account's newest card by highest (date, minute of time, seq) */
export function newestCardsByAccount(cards: BalanceCard[]): Record<string, BalanceCard> {
  const newest: Record<string, BalanceCard> = {};
  for (const card of cards) {
    const prev = newest[card.account];
    if (!prev || compareCards(card, prev) > 0) {
      newest[card.account] = card;
    }
  }
  return newest;
}

/**
 * Computes displayed balances (from the newest KBank Live card per account when present, otherwise
 * the ledger balance), the ledger balance cut off at each card's date and time, and the gap
 * (ledger - card) rounded to 2 decimals. Accounts with no card yet keep their ledger balance and
 * have a null gap.
 */
export function computeAccountBalancesWithCards(
  transactions: BalanceTransaction[],
  anchors: BalanceAnchor[] = [],
  cards: BalanceCard[] = [],
  baseline: Record<string, number> = BASELINE_BALANCES,
  baselineDate: string = BASELINE_DATE,
): AccountBalancesWithCards {
  const newest = newestCardsByAccount(cards);
  const cutoffs: Record<string, BalanceCutoff> = {};
  for (const acc of CARD_ACCOUNTS) {
    const card = newest[acc];
    if (card) {
      cutoffs[acc] = { date: card.date, time: card.time };
    }
  }

  const { balances: ledgerBalances, asOf } = computeAccountBalances(
    transactions,
    anchors,
    baseline,
    baselineDate,
    cutoffs,
  );

  const balances: Record<string, number> = { ...ledgerBalances };
  const gaps: Record<string, number | null> = {};
  const cardTimes: Record<string, string | null> = {};

  for (const acc of CARD_ACCOUNTS) {
    const card = newest[acc];
    if (card) {
      const cardBal = round2(card.balance);
      balances[acc] = cardBal;
      gaps[acc] = round2((ledgerBalances[acc] ?? 0) - cardBal);
      cardTimes[acc] = `${card.date} ${minuteKey(card.time)}`;
    } else {
      gaps[acc] = null;
      cardTimes[acc] = null;
    }
  }

  const totalCash = round2(Object.values(balances).reduce((sum, b) => sum + b, 0));

  return {
    balances,
    ledgerBalances,
    gaps,
    cardTimes,
    asOf,
    totalCash,
  };
}
