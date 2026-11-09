// Runs a card or a slip batch through the ledger rules. Everything outside (sheet, Postgres, lock)
// comes in through LedgerStore, so the whole flow is tested without either.
// No `@/` imports here: this module is loaded directly by the node test runner.
import { createHash } from 'node:crypto';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseCard } from './kbank-card.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { alertsResolvedBy, checkContinuity, isFingerprinted, planCardIngest, planSlipReconcile, rowFingerprint } from './reconcile.ts';
import type { KBankCard, RawCard } from './kbank-card.ts';
import type {
  AppendOp, DeleteOp, LedgerOp, LedgerView, LineAlert, LineRow, RowFingerprint, SlipFact, SlipOutcome, SlipResult, StoredCard, UpdateOp,
} from './reconcile.ts';

export interface LedgerStore {
  /** Serialises everything that reads the sheet to decide a write, across requests and processes */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  readRows(): Promise<LineRow[]>;
  findCard(key: string): Promise<StoredCard | null>;
  listCards(): Promise<StoredCard[]>;
  saveCard(card: KBankCard, txId: string): Promise<void>;
  relinkCards(links: Array<{ key: string; txId: string }>): Promise<void>;
  readFingerprints(): Promise<Map<string, RowFingerprint>>;
  prepareFingerprints(rows: Array<{ id: string; fingerprint: string }>): Promise<void>;
  commitFingerprints(rows: Array<{ id: string; fingerprint: string }>): Promise<void>;
  appendRows(rows: LineRow[]): Promise<void>;
  /** Find each row by id; must reject the whole call if a row is gone or no longer matches `expected` */
  updateRows(ops: UpdateOp[]): Promise<void>;
  deleteRows(ops: DeleteOp[]): Promise<void>;
  unappliedSlips(): Promise<SlipFact[]>;
  markSlipsApplied(results: SlipResult[]): Promise<void>;
  recordAlerts(alerts: LineAlert[]): Promise<void>;
  resolveAlerts(ids: string[]): Promise<void>;
}

async function readView(store: LedgerStore): Promise<LedgerView> {
  const [rows, cards, fingerprints] = await Promise.all([store.readRows(), store.listCards(), store.readFingerprints()]);
  return { rows, cards, fingerprints };
}

/**
 * Writes a plan in order (see the reconcile rules for why some orders matter). Each step re-finds
 * rows by id, so a shift from an earlier step cannot misdirect a later one. The fingerprint is
 * stored before the write and confirmed after it, so a crash in between does not read as a hand edit.
 */
async function applyOps(store: LedgerStore, ops: LedgerOp[]): Promise<void> {
  const owned = ops
    .flatMap(o => (o.kind === 'delete' ? [] : [o.row]))
    .filter(isFingerprinted)
    .map(row => ({ id: row.id, fingerprint: rowFingerprint(row) }));
  if (owned.length > 0) await store.prepareFingerprints(owned);

  // Consecutive operations of one kind go out as one sheet call
  for (let i = 0; i < ops.length;) {
    const kind = ops[i].kind;
    let end = i;
    while (end < ops.length && ops[end].kind === kind) end++;
    const batch = ops.slice(i, end);
    if (kind === 'append') await store.appendRows(batch.map(o => (o as AppendOp).row));
    else if (kind === 'delete') await store.deleteRows(batch as DeleteOp[]);
    else await store.updateRows(batch as UpdateOp[]);
    i = end;
  }

  if (owned.length > 0) await store.commitFingerprints(owned);
}

export type IngestResult =
  | { status: 'duplicate'; txId: string; warnings: string[] }
  | { status: 'needs_review'; reason: string; alertId: string; warnings: string[] }
  | { status: 'added' | 'attached' | 'paired' | 'recovered'; txId: string; warnings: string[] };

function reviewAlertFor(raw: RawCard, reason: string): LineAlert {
  const payload = { title: raw.title, date: raw.date, account: raw.account, amount: raw.amount, balance: raw.balance, messageId: raw.messageId };
  return {
    id: `review:${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 24)}`,
    kind: 'NEEDS_REVIEW',
    account: null,
    message: `การ์ด LINE รอตรวจสอบ: ${reason}`,
    payload,
  };
}

export async function ingestCard(raw: RawCard, store: LedgerStore): Promise<IngestResult> {
  const parsed = parseCard(raw);
  if (!parsed.ok) {
    const alert = reviewAlertFor(raw, parsed.reason);
    await store.recordAlerts([alert]);
    return { status: 'needs_review', reason: parsed.reason, alertId: alert.id, warnings: [alert.message] };
  }
  const card = parsed.card;

  return store.withLock(async () => {
    const existing = await store.findCard(card.key);
    if (existing) return { status: 'duplicate', txId: existing.txId, warnings: [] };

    const view = await readView(store);
    const plan = planCardIngest(card, view);
    await applyOps(store, plan.ops);
    // Recorded after the row is written: a failure here leaves the card to be retried, and the
    // retry finds the row by its id or the same pairing instead of writing another row
    await store.saveCard(card, plan.txId);

    const alerts = [...plan.alerts];
    const gap = checkContinuity(card, view.cards);
    if (gap) alerts.push(gap);
    if (alerts.length > 0) await store.recordAlerts(alerts);
    const resolved = alertsResolvedBy(card, view.cards);
    if (resolved.length > 0) await store.resolveAlerts(resolved);

    return { status: plan.outcome, txId: plan.txId, warnings: alerts.map(a => a.message) };
  });
}

export type SlipReconcileCounts = Record<SlipOutcome, number>;

/** Applies every slip not yet in the ledger, against the rows as they are now */
export async function reconcileSlips(store: LedgerStore): Promise<SlipReconcileCounts> {
  return store.withLock(async () => {
    const slips = await store.unappliedSlips();
    const counts: SlipReconcileCounts = { merged: 0, corrected: 0, confirmed: 0, undone: 0, adopted: 0, protected: 0, appended: 0, already: 0 };
    if (slips.length === 0) return counts;

    const view = await readView(store);
    const plan = planSlipReconcile(slips, view);
    await applyOps(store, plan.ops);
    if (plan.cardLinks.length > 0) await store.relinkCards(plan.cardLinks);
    await store.markSlipsApplied(plan.results);
    for (const result of plan.results) counts[result.outcome]++;
    return counts;
  });
}
