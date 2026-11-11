// Server side of the balance adjustment: the ledger state the dashboard shows, and the one write that
// brings an account's ledger balance to its newest KBank Live card.
// Relative imports: the Postgres tests load this module without the `@/` alias.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getStatementBalances } from './index.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { withLedgerLock } from './line-ledger.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { appendTransactionRow, getAllTransactions } from './transactions.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getLatestLineCards } from '../line/latest-cards.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { CARD_ACCOUNTS, computeAccountBalancesWithCards, newestCardsByAccount } from '../balance/account-balances.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { planBalanceAdjustment } from '../balance/balance-adjustment.ts';
import type { AccountBalancesWithCards, BalanceAnchor, BalanceCard } from '../balance/account-balances.ts';
import type { Transaction } from '../../types/index.ts';

export type LedgerBalanceState = AccountBalancesWithCards & {
  /** The newest KBank Live card per card account */
  newestCards: Record<string, BalanceCard>;
};

/**
 * Balances and gaps of `transactions`, from the newest statement closing balances and KBank Live cards.
 * The dashboard (GET /api/transactions) tolerates a failed read of either, as it always did, and shows
 * ledger balances only; a write that decides an amount from the gap must not, so it passes
 * `tolerant: false` and fails instead of acting on a partial picture.
 */
export async function computeLedgerState(transactions: Transaction[], tolerant: boolean): Promise<LedgerBalanceState> {
  let anchors: BalanceAnchor[] = [];
  try {
    anchors = await getStatementBalances();
  } catch (err: unknown) {
    if (!tolerant) throw err;
    console.error('Error reading statement balances, using the 2026-09-04 baseline only:', err instanceof Error ? err.message : err);
  }
  let cards: BalanceCard[] = [];
  try {
    cards = await getLatestLineCards();
  } catch (err: unknown) {
    if (!tolerant) throw err;
    console.error('Error reading LINE card balances, using ledger balances only:', err instanceof Error ? err.message : err);
  }
  return { ...computeAccountBalancesWithCards(transactions, anchors, cards), newestCards: newestCardsByAccount(cards) };
}

/** A request the owner can fix; `status` is the HTTP status to answer with */
export class BalanceAdjustmentError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BalanceAdjustmentError';
    this.status = status;
  }
}

export interface BalanceAdjustmentResult {
  /** The row added, or null when the account already matched its card */
  transaction: Transaction | null;
  /** The gap after the call (always 0) */
  gap: number;
}

export function isCardAccount(account: unknown): account is (typeof CARD_ACCOUNTS)[number] {
  return typeof account === 'string' && (CARD_ACCOUNTS as readonly string[]).includes(account);
}

/**
 * Adds the row that makes `account`'s ledger balance equal its newest card's balance. The amount comes
 * from the gap computed here from the database, under the ledger lock, never from the caller; with no
 * gap nothing is added, so repeating the call adds nothing. If the row would not close the gap (e.g. a
 * card dated before the baseline) the whole write rolls back.
 */
export async function adjustAccountBalance(account: string): Promise<BalanceAdjustmentResult> {
  if (!isCardAccount(account)) throw new BalanceAdjustmentError('บัญชีนี้ไม่มีการ์ด KBank Live ให้เทียบยอด', 400);

  return withLedgerLock(async () => {
    const state = await computeLedgerState(await getAllTransactions(), false);
    const card = state.newestCards[account];
    const gap = state.gaps[account];
    if (!card || gap === null || gap === undefined) {
      throw new BalanceAdjustmentError(`ยังไม่มีการ์ด KBank Live ของ ${account} ให้เทียบยอด`, 409);
    }

    const plan = planBalanceAdjustment(account, gap, card);
    if (!plan) return { transaction: null, gap: 0 };

    const transaction: Transaction = {
      id: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...plan,
      createdAt: new Date().toISOString(),
    };
    await appendTransactionRow(transaction);

    const after = await computeLedgerState(await getAllTransactions(), false);
    if (after.gaps[account] !== 0) {
      throw new BalanceAdjustmentError('เพิ่มรายการปรับยอดแล้วยอดยังไม่ตรงกับธนาคาร จึงยกเลิกการเพิ่ม', 409);
    }
    return { transaction, gap: 0 };
  });
}
