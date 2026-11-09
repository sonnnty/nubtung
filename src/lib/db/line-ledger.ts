// Postgres side of the LINE ledger: cards seen, slip facts, row fingerprints and alerts.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getPool, inTransaction, query, withTransaction } from './index.ts';
import type { KBankCard } from '../line/kbank-card.ts';
import type { LineAlert, RowFingerprint, SlipFact, SlipOutcome, StoredCard } from '../line/reconcile.ts';

/** Arbitrary but fixed key of the Postgres advisory lock serialising everything that writes the ledger */
const LEDGER_LOCK_KEY = 736401;
/** Cards older than this cannot match a new card or slip any more */
const CARD_LOOKBACK_DAYS = 60;

let schemaPromise: Promise<void> | null = null;

export function initLineLedgerSchema(): Promise<void> {
  if (!schemaPromise) {
    // On the pool, never a caller's transaction: a rollback must not undo the memoized schema
    schemaPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS line_cards (
        card_key TEXT PRIMARY KEY,
        seq BIGSERIAL,
        account VARCHAR(100) NOT NULL,
        txn_date VARCHAR(10) NOT NULL,
        txn_time VARCHAR(8) NOT NULL,
        direction VARCHAR(3) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        balance NUMERIC(15, 2) NOT NULL,
        title TEXT NOT NULL,
        message_id TEXT,
        tx_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_line_cards_date ON line_cards(txn_date);
      CREATE INDEX IF NOT EXISTS idx_line_cards_tx ON line_cards(tx_id);

      CREATE TABLE IF NOT EXISTS line_row_fingerprints (
        tx_id TEXT PRIMARY KEY,
        fingerprint TEXT,
        pending_fingerprint TEXT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS slip_facts (
        drive_file_id VARCHAR(255) PRIMARY KEY,
        account VARCHAR(100) NOT NULL,
        txn_date VARCHAR(10) NOT NULL,
        txn_time VARCHAR(8) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        tx_type VARCHAR(10) NOT NULL,
        category TEXT NOT NULL,
        note TEXT NOT NULL,
        slip_url TEXT NOT NULL,
        receiver_account TEXT,
        applied_tx_id TEXT,
        outcome VARCHAR(20),
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_slip_facts_unapplied ON slip_facts(created_at) WHERE applied_at IS NULL;

      CREATE TABLE IF NOT EXISTS line_alerts (
        id TEXT PRIMARY KEY,
        kind VARCHAR(40) NOT NULL,
        account VARCHAR(100),
        message TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_line_alerts_open ON line_alerts(created_at) WHERE resolved_at IS NULL;
    `).then(() => undefined, (err: unknown) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

/**
 * Runs `fn` as one DB transaction holding the ledger lock, so everything that reads rows to decide a
 * write (cards, slip reconciliation, statement import, row edits) runs one at a time, across
 * processes too, and all of it commits or rolls back together. Every `query` inside runs on the
 * lock's own client (see withTransaction), so a waiter never needs a second pooled connection.
 * It is a transaction-scoped advisory lock: Postgres releases it if this process dies. Waiting is
 * bounded so a stuck holder surfaces as an error instead of hanging the webhook.
 */
export async function withLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
  if (inTransaction()) return fn();

  await initLineLedgerSchema();
  return withTransaction(async () => {
    await query(`SET LOCAL lock_timeout = '60s'`);
    await query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);
    return fn();
  });
}

const CARD_COLUMNS = `card_key as key, seq::float as seq, account, txn_date as date, txn_time as time, direction,
  amount::float as amount, balance::float as balance, title, tx_id as "txId"`;

export async function findLineCard(key: string): Promise<StoredCard | null> {
  await initLineLedgerSchema();
  const res = await query<StoredCard>(`SELECT ${CARD_COLUMNS} FROM line_cards WHERE card_key = $1`, [key]);
  return res.rows[0] ?? null;
}

export async function listRecentLineCards(): Promise<StoredCard[]> {
  await initLineLedgerSchema();
  const res = await query<StoredCard>(
    `SELECT ${CARD_COLUMNS} FROM line_cards
     WHERE txn_date >= to_char(CURRENT_DATE - $1::int, 'YYYY-MM-DD')
     ORDER BY txn_date, txn_time, seq`,
    [CARD_LOOKBACK_DAYS],
  );
  return res.rows;
}

export async function saveLineCard(card: KBankCard, txId: string): Promise<void> {
  await initLineLedgerSchema();
  await query(
    `INSERT INTO line_cards (card_key, account, txn_date, txn_time, direction, amount, balance, title, message_id, tx_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (card_key) DO NOTHING`,
    [card.key, card.account, card.date, card.time, card.direction, card.amount, card.balance, card.title, card.messageId, txId],
  );
}

export async function relinkLineCards(links: Array<{ key: string; txId: string }>): Promise<void> {
  await initLineLedgerSchema();
  for (const { key, txId } of links) {
    await query('UPDATE line_cards SET tx_id = $1 WHERE card_key = $2', [txId, key]);
  }
}

export async function readRowFingerprints(): Promise<Map<string, RowFingerprint>> {
  await initLineLedgerSchema();
  const res = await query<{ tx_id: string; fingerprint: string | null; pending_fingerprint: string | null }>(
    'SELECT tx_id, fingerprint, pending_fingerprint FROM line_row_fingerprints',
  );
  return new Map(res.rows.map(r => [r.tx_id, { fingerprint: r.fingerprint, pendingFingerprint: r.pending_fingerprint }]));
}

export async function prepareRowFingerprints(rows: Array<{ id: string; fingerprint: string }>): Promise<void> {
  await initLineLedgerSchema();
  for (const { id, fingerprint } of rows) {
    await query(
      `INSERT INTO line_row_fingerprints (tx_id, pending_fingerprint) VALUES ($1, $2)
       ON CONFLICT (tx_id) DO UPDATE SET pending_fingerprint = EXCLUDED.pending_fingerprint, updated_at = CURRENT_TIMESTAMP`,
      [id, fingerprint],
    );
  }
}

export async function commitRowFingerprints(rows: Array<{ id: string; fingerprint: string }>): Promise<void> {
  await initLineLedgerSchema();
  for (const { id, fingerprint } of rows) {
    await query(
      `UPDATE line_row_fingerprints SET fingerprint = $1, pending_fingerprint = NULL, updated_at = CURRENT_TIMESTAMP WHERE tx_id = $2`,
      [fingerprint, id],
    );
  }
}

/** Keeps what OCR read. A slip is only applied once; re-OCR of a known file keeps the first reading. */
export async function saveSlipFact(slip: SlipFact): Promise<void> {
  await initLineLedgerSchema();
  await query(
    `INSERT INTO slip_facts (drive_file_id, account, txn_date, txn_time, amount, tx_type, category, note, slip_url, receiver_account)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (drive_file_id) DO NOTHING`,
    [slip.driveFileId, slip.account, slip.date, slip.time, slip.amount, slip.type, slip.category, slip.note, slip.slipUrl, slip.receiverAccount ?? null],
  );
}

export async function listUnappliedSlipFacts(): Promise<SlipFact[]> {
  await initLineLedgerSchema();
  const res = await query<SlipFact & { receiverAccount: string | null }>(
    `SELECT drive_file_id as "driveFileId", account, txn_date as date, txn_time as time, amount::float as amount,
            tx_type as type, category, note, slip_url as "slipUrl", receiver_account as "receiverAccount"
     FROM slip_facts WHERE applied_at IS NULL ORDER BY created_at`,
  );
  return res.rows.map(r => ({ ...r, receiverAccount: r.receiverAccount ?? undefined }));
}

export async function markSlipFactsApplied(results: Array<{ driveFileId: string; txId: string; outcome: SlipOutcome }>): Promise<void> {
  await initLineLedgerSchema();
  for (const { driveFileId, txId, outcome } of results) {
    await query(
      `UPDATE slip_facts SET applied_tx_id = $1, outcome = $2, applied_at = CURRENT_TIMESTAMP WHERE drive_file_id = $3`,
      [txId, outcome, driveFileId],
    );
  }
}

export async function recordLineAlerts(alerts: LineAlert[]): Promise<void> {
  await initLineLedgerSchema();
  for (const alert of alerts) {
    await query(
      `INSERT INTO line_alerts (id, kind, account, message, payload) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [alert.id, alert.kind, alert.account, alert.message, JSON.stringify(alert.payload ?? null)],
    );
  }
}

export async function resolveLineAlerts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await initLineLedgerSchema();
  await query('UPDATE line_alerts SET resolved_at = CURRENT_TIMESTAMP WHERE id = ANY($1) AND resolved_at IS NULL', [ids]);
}

export interface OpenLineAlert {
  id: string;
  kind: LineAlert['kind'];
  account: string | null;
  message: string;
  createdAt: string;
}

/** Newest first; capped so a burst of alerts cannot bloat the transactions response */
export async function getOpenLineAlerts(limit = 50): Promise<OpenLineAlert[]> {
  await initLineLedgerSchema();
  const res = await query<OpenLineAlert>(
    `SELECT id, kind, account, message, created_at::text as "createdAt" FROM line_alerts
     WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows;
}
