// Balance adjustment rows ("รายการปรับจำนวนเงิน"): one row that brings an account's ledger balance to the
// newest KBank Live card's balance, instead of hunting down every missing row.
// No `@/` imports here: this module is loaded directly by the node test runner and by client code.
//
// An adjustment is stored like any other row (source MANUAL, so slip / card / statement reconciliation
// never rewrites it) and counts in account balances. It is neither income nor spending: every total,
// breakdown, chart and the tax income skip it, and every matcher skips it too. What marks it is the
// category alone, so the mark survives edits of its amount or note.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { minuteKey } from './account-balances.ts';

export const BALANCE_ADJUSTMENT_CATEGORY = 'ปรับยอดเงิน';

export function isBalanceAdjustment(tx: { category?: string | null }): boolean {
  return (tx.category || '').trim() === BALANCE_ADJUSTMENT_CATEGORY;
}

/** The rows that are real income / spending / transfers */
export function withoutBalanceAdjustments<T extends { category?: string | null }>(txs: T[]): T[] {
  return txs.filter(tx => !isBalanceAdjustment(tx));
}

/** The newest card of the account being adjusted */
export interface AdjustmentCard {
  date: string;
  time: string;
  balance: number;
}

export interface BalanceAdjustmentRow {
  date: string;
  time: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  account: string;
  note: string;
  source: 'MANUAL';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The row that closes `gap` (ledger - card, as computed by computeAccountBalancesWithCards) for an
 * account, or null when there is nothing to close. A negative gap (ledger below the bank) needs
 * INCOME, a positive one EXPENSE. It is dated at the card's own date and time so that it falls inside
 * the card's cutoff (a row at exactly the cutoff minute counts) and the gap becomes 0.
 */
export function planBalanceAdjustment(
  account: string,
  gap: number | null | undefined,
  card: AdjustmentCard,
): BalanceAdjustmentRow | null {
  if (gap === null || gap === undefined || !Number.isFinite(gap)) return null;
  const amount = round2(Math.abs(gap));
  if (amount === 0) return null;
  return {
    date: card.date,
    time: card.time,
    type: gap < 0 ? 'INCOME' : 'EXPENSE',
    amount,
    category: BALANCE_ADJUSTMENT_CATEGORY,
    account,
    note: `รายการปรับจำนวนเงิน: ให้ยอดตรงกับธนาคาร (KBank Live ${card.date} ${minuteKey(card.time)} ยอด ${formatMoney(card.balance)})`,
    source: 'MANUAL',
  };
}

/** What the confirm dialog tells the owner will be added */
export function describeBalanceAdjustment(account: string, gap: number): string {
  const kind = gap < 0 ? 'รายรับ' : 'รายจ่าย';
  return `เพิ่มรายการ${kind} ฿${formatMoney(Math.abs(gap))} ใน ${account} เพื่อให้ตรงกับยอดธนาคาร`;
}
