import { query } from '@/lib/db';
import { initLineLedgerSchema } from '@/lib/db/line-ledger';
import type { BalanceCard } from '@/lib/balance/account-balances';

/** Reads the newest KBank Live card per account from Postgres by highest (txn_date, txn_time, seq) */
export async function getLatestLineCards(): Promise<BalanceCard[]> {
  await initLineLedgerSchema();
  const res = await query<BalanceCard>(
    `SELECT DISTINCT ON (account)
       account,
       txn_date as date,
       txn_time as time,
       balance::float as balance,
       seq::float as seq
     FROM line_cards
     ORDER BY account, txn_date DESC, txn_time DESC, seq DESC`,
  );
  return res.rows;
}
