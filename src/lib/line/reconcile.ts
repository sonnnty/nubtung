// The rules of the LINE ledger: what a KBank Live card or a slip does to the rows in the sheet.
// No `@/` imports here: this module is loaded directly by the node test runner.
//
// A card writes a row at once (source LINE, category รอระบุ), so balances are right in real time.
// - An out card and an in card on different tracked accounts, same amount, within 3 minutes are one
//   TRANSFER on the sending account, kept provisional (source still LINE) until a slip confirms it.
// - A row already backed by a slip or statement takes the card without changing or adding a row.
//
// A slip is the authority on what a payment was. It matches a LINE row on account + amount + time
// within 5 minutes, one row per slip, nearest time wins:
// - the row is updated in place, never duplicated, and becomes LINE+SLIP;
// - a slip showing a self-transfer turns an EXPENSE into a TRANSFER; a slip showing someone else undoes
//   a provisional pair and restores one row per card;
// - rows the owner edited in the web app (editedAt) are never written; a slip that matches one is consumed.
//
// Every write names the row by id. Plans and writes run in one ledger transaction, so nothing can
// change a row between the two.
import { createHash } from 'node:crypto';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { internalTransferNote, isLineSourced } from '../statement/import-plan.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { resolveTransferDestination } from '../balance/transfer-destination.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { trackedAccountFromNumber } from '../statement/accounts.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { cardRowId } from './kbank-card.ts';
import type { LedgerRow, TxType } from '../statement/import-plan.ts';
import type { CardDirection, KBankCard } from './kbank-card.ts';

export const PENDING_CATEGORY = 'รอระบุ';
export const TRANSFER_CATEGORY = 'โอนระหว่างบัญชี';
export const LINE_SOURCE = 'LINE';
export const LINE_MATCHED_SOURCE = 'LINE+SLIP';
export const TRANSFER_PAIR_MINUTES = 3;
export const SLIP_MATCH_MINUTES = 5;
const PROVISIONAL_NOTE_ORIGIN = 'LINE รอตรวจสอบสลิป';
const SLIP_NOTE_ORIGIN = 'สลิป';

export interface LineRow extends LedgerRow {
  id: string;
  time: string;
  category: string;
  note: string;
  source: string;
  /** Set when the owner edited the row in the web app */
  editedAt?: string;
}

/** A card already in the ledger: which row carries it now */
export interface StoredCard extends Omit<KBankCard, 'messageId'> {
  txId: string;
  /** Arrival order; breaks ties between cards of the same minute */
  seq: number;
}

/**
 * How a slip reads after OCR. Stored in Postgres, so a slip whose row could not be written yet can
 * still be applied by a later run, however processed_slips recorded it.
 */
export interface SlipFact {
  driveFileId: string;
  account: string;
  date: string;
  time: string;
  amount: number;
  type: TxType;
  category: string;
  note: string;
  slipUrl: string;
  receiverAccount?: string;
}

export interface LedgerView {
  rows: LineRow[];
  cards: StoredCard[];
}

export type AppendOp = { kind: 'append'; row: LineRow };
export type UpdateOp = { kind: 'update'; row: LineRow };
export type DeleteOp = { kind: 'delete'; id: string };
export type LedgerOp = AppendOp | UpdateOp | DeleteOp;

export type AlertKind = 'MISSING_CARD' | 'NEEDS_REVIEW' | 'POSSIBLE_MANUAL_DUPLICATE';

export interface LineAlert {
  id: string;
  kind: AlertKind;
  account: string | null;
  message: string;
  payload?: unknown;
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function minuteOf(when: { date: string; time: string }): number {
  const [y, m, d] = when.date.split('-').map(Number);
  const [h, min] = when.time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min) / 60000;
}

/** Infinity for a row whose date cannot be read, so it never counts as close */
function minutesApart(a: { date: string; time: string }, b: { date: string; time: string }): number {
  const distance = Math.abs(minuteOf(a) - minuteOf(b));
  return Number.isNaN(distance) ? Infinity : distance;
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

function linksByRow(cards: StoredCard[]): Map<string, StoredCard[]> {
  const links = new Map<string, StoredCard[]>();
  for (const card of cards) {
    const list = links.get(card.txId);
    if (list) list.push(card);
    else links.set(card.txId, [card]);
  }
  return links;
}

/** Written by the automation and not changed by the owner since */
function isAutomationOwned(row: LineRow): boolean {
  return isLineSourced(row.source) && !row.editedAt;
}

/** A LINE row the automation may still change: not yet matched to a slip, not touched by the owner */
function isOpen(row: LineRow): boolean {
  return row.source === LINE_SOURCE && isAutomationOwned(row);
}

function nearestBy<T>(items: T[], distance: (item: T) => number): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const d = distance(item);
    if (d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

export function pendingRowForCard(card: KBankCard | StoredCard): LineRow {
  return {
    id: cardRowId(card.key),
    date: card.date,
    time: card.time,
    type: card.direction === 'OUT' ? 'EXPENSE' : 'INCOME',
    amount: card.amount,
    category: PENDING_CATEGORY,
    account: card.account,
    note: `LINE: ${card.title}`,
    source: LINE_SOURCE,
  };
}

function provisionalTransferRow(row: LineRow, out: { account: string; date: string; time: string }, receiver: string): LineRow {
  return {
    ...row,
    date: out.date,
    time: out.time,
    type: 'TRANSFER',
    category: TRANSFER_CATEGORY,
    account: out.account,
    note: internalTransferNote(out.account, receiver, undefined, PROVISIONAL_NOTE_ORIGIN),
  };
}

function updateOp(row: LineRow): UpdateOp {
  return { kind: 'update', row };
}

export interface CardPlan {
  outcome: 'added' | 'attached' | 'paired' | 'recovered';
  txId: string;
  ops: LedgerOp[];
  alerts: LineAlert[];
}

/** Can this finished row (slip, statement or a row the owner decided) carry the card without changing? */
function canAttachCard(row: LineRow, card: KBankCard, links: Map<string, StoredCard[]>): boolean {
  if (row.source === 'MANUAL' || isOpen(row)) return false;
  if (!sameAmount(row.amount, card.amount) || minutesApart(row, card) > SLIP_MATCH_MINUTES) return false;
  if ((links.get(row.id) || []).some(c => c.direction === card.direction)) return false;
  if (card.direction === 'OUT') {
    return row.account === card.account && (row.type === 'EXPENSE' || row.type === 'TRANSFER');
  }
  return (row.account === card.account && row.type === 'INCOME') ||
    (row.type === 'TRANSFER' && row.account !== card.account &&
      resolveTransferDestination(row.note, row.account) === card.account);
}

/** The other card of an open single-card row that this card forms an internal transfer with */
function transferPartner(row: LineRow, card: KBankCard, links: Map<string, StoredCard[]>): StoredCard | null {
  if (!isOpen(row)) return null;
  const rowCards = links.get(row.id) || [];
  if (rowCards.length !== 1) return null;
  const other = rowCards[0];
  if (other.direction === card.direction || other.account === card.account) return null;
  if (!sameAmount(other.amount, card.amount) || minutesApart(other, card) > TRANSFER_PAIR_MINUTES) return null;
  return other;
}

/** What a new card does to the sheet. The card's key has already been checked to be new. */
export function planCardIngest(card: KBankCard, view: LedgerView): CardPlan {
  const rowId = cardRowId(card.key);
  // A previous attempt wrote this card's row but crashed before recording the card
  if (view.rows.some(r => r.id === rowId)) {
    return { outcome: 'recovered', txId: rowId, ops: [], alerts: [] };
  }

  const links = linksByRow(view.cards);

  // Slip first, card after: the row already says what the payment was
  const carrier = nearestBy(
    view.rows.filter(r => canAttachCard(r, card, links)),
    r => minutesApart(r, card),
  );
  if (carrier) return { outcome: 'attached', txId: carrier.id, ops: [], alerts: [] };

  const pairs = view.rows
    .map(row => ({ row, other: transferPartner(row, card, links) }))
    .filter((p): p is { row: LineRow; other: StoredCard } => p.other !== null);
  const pair = nearestBy(pairs, p => minutesApart(p.other, card));
  if (pair) {
    const [out, receiver] = card.direction === 'OUT' ? [card, pair.other] : [pair.other, card];
    const row = provisionalTransferRow(pair.row, out, receiver.account);
    return { outcome: 'paired', txId: pair.row.id, ops: [updateOp(row)], alerts: [] };
  }

  const alerts: LineAlert[] = [];
  const manual = view.rows.find(r =>
    r.source === 'MANUAL' && r.account === card.account && sameAmount(r.amount, card.amount) &&
    minutesApart(r, card) <= SLIP_MATCH_MINUTES);
  if (manual) {
    alerts.push({
      id: `manual-dup:${card.key}`,
      kind: 'POSSIBLE_MANUAL_DUPLICATE',
      account: card.account,
      message: `การ์ด LINE ฿${card.amount} อาจซ้ำกับรายการที่บันทึกเอง "${manual.note || manual.category}" (${manual.date} ${manual.time})`,
    });
  }
  return { outcome: 'added', txId: rowId, ops: [{ kind: 'append', row: pendingRowForCard(card) }], alerts };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function signedAmount(card: { direction: CardDirection; amount: number }): number {
  return card.direction === 'OUT' ? -card.amount : card.amount;
}

/**
 * Whether a previous card's balance leads to this card's. Time order within the same minute is unknown,
 * so any card of that minute may be the one before it.
 */
export function checkContinuity(card: KBankCard, history: StoredCard[]): LineAlert | null {
  const earlier = history
    .filter(c => c.account === card.account && minuteOf(c) <= minuteOf(card))
    .sort((a, b) => minuteOf(a) - minuteOf(b) || a.seq - b.seq);
  if (earlier.length === 0) return null;

  const latestMinute = minuteOf(earlier[earlier.length - 1]);
  const chains = earlier
    .filter(c => minuteOf(c) === latestMinute || minuteOf(c) === minuteOf(card))
    .some(c => sameAmount(round2(c.balance + signedAmount(card)), card.balance));
  if (chains) return null;

  const previous = earlier[earlier.length - 1];
  const expected = round2(previous.balance + signedAmount(card));
  return {
    id: `missing:${card.key}`,
    kind: 'MISSING_CARD',
    account: card.account,
    message: `ยอดคงเหลือ ${card.account} ไม่ต่อเนื่อง: ควรเป็น ฿${expected.toFixed(2)} แต่การ์ด ${card.date} ${card.time.slice(0, 5)} แจ้ง ฿${card.balance.toFixed(2)} (อาจมีการ์ดหาย)`,
    payload: { cardKey: card.key, previousKey: previous.key, expected, actual: card.balance },
  };
}

/** Ids of earlier missing-card alerts this card now explains (a late card fills the gap) */
export function alertsResolvedBy(card: KBankCard, history: StoredCard[]): string[] {
  return history
    .filter(c =>
      c.account === card.account && minuteOf(c) >= minuteOf(card) &&
      sameAmount(round2(card.balance + signedAmount(c)), c.balance))
    .map(c => `missing:${c.key}`);
}

export type SlipOutcome = 'merged' | 'corrected' | 'confirmed' | 'undone' | 'adopted' | 'protected' | 'appended' | 'already';

export interface SlipResult {
  driveFileId: string;
  txId: string;
  outcome: SlipOutcome;
}

export interface SlipPlan {
  ops: LedgerOp[];
  results: SlipResult[];
  /** Cards that now live on a different row */
  cardLinks: Array<{ key: string; txId: string }>;
}

function slipDirection(slip: SlipFact): CardDirection {
  return slip.type === 'INCOME' ? 'IN' : 'OUT';
}

/** The receiving account of a self-transfer slip, or null when the slip does not say */
function slipDestination(slip: SlipFact): string | null {
  const fromNote = resolveTransferDestination(slip.note, slip.account);
  if (fromNote && fromNote !== slip.account) return fromNote;
  const fromNumber = trackedAccountFromNumber(slip.receiverAccount);
  return fromNumber && fromNumber !== slip.account ? fromNumber : null;
}

function slipTransferNote(slip: SlipFact, to: string): string {
  return resolveTransferDestination(slip.note, slip.account) === to
    ? slip.note
    : internalTransferNote(slip.account, to, slip.note, SLIP_NOTE_ORIGIN);
}

/** The row as the slip says it is */
function rowWithSlip(base: LineRow, slip: SlipFact, destination: string | null): LineRow {
  return {
    ...base,
    type: slip.type,
    category: slip.category,
    note: slip.type === 'TRANSFER' && destination ? slipTransferNote(slip, destination) : slip.note,
    slipUrl: slip.slipUrl,
    driveFileId: slip.driveFileId,
    source: LINE_MATCHED_SOURCE,
  };
}

interface Candidate {
  slip: SlipFact;
  card: StoredCard;
  row: LineRow;
  kind: 'single' | 'pair' | 'adopt';
  distance: number;
}

function findCandidates(slip: SlipFact, view: LedgerView, rowsById: Map<string, LineRow>, links: Map<string, StoredCard[]>): Candidate[] {
  const candidates: Candidate[] = [];
  const near = (card: StoredCard) => sameAmount(card.amount, slip.amount) && minutesApart(card, slip) <= SLIP_MATCH_MINUTES;

  for (const card of view.cards) {
    if (card.account !== slip.account || card.direction !== slipDirection(slip) || !near(card)) continue;
    const row = rowsById.get(card.txId);
    if (!row || row.source !== LINE_SOURCE) continue;
    const paired = (links.get(row.id) || []).length > 1;
    candidates.push({ slip, card, row, kind: paired ? 'pair' : 'single', distance: minutesApart(card, slip) });
  }

  // Only the in card of a self-transfer has arrived: that row is this transfer's money arriving
  if (slip.type === 'TRANSFER') {
    const destination = slipDestination(slip);
    for (const card of view.cards) {
      if (!destination || card.account !== destination || card.direction !== 'IN' || !near(card)) continue;
      const row = rowsById.get(card.txId);
      if (!row || row.source !== LINE_SOURCE || (links.get(row.id) || []).length > 1) continue;
      candidates.push({ slip, card, row, kind: 'adopt', distance: minutesApart(card, slip) });
    }
  }
  return candidates;
}

/** Slips onto rows: every card row first, nearest time, then the row kind the slip's type expects */
function assignSlips(candidates: Candidate[]): Candidate[] {
  const preference = (c: Candidate) => {
    if (c.kind === 'adopt') return 2;
    return (c.kind === 'pair') === (c.slip.type === 'TRANSFER') ? 0 : 1;
  };
  const sorted = [...candidates].sort((a, b) =>
    (a.kind === 'adopt' ? 1 : 0) - (b.kind === 'adopt' ? 1 : 0) ||
    a.distance - b.distance ||
    preference(a) - preference(b));

  const usedSlips = new Set<string>();
  const usedRows = new Set<string>();
  const assigned: Candidate[] = [];
  for (const candidate of sorted) {
    if (usedSlips.has(candidate.slip.driveFileId) || usedRows.has(candidate.row.id)) continue;
    usedSlips.add(candidate.slip.driveFileId);
    usedRows.add(candidate.row.id);
    assigned.push(candidate);
  }
  return assigned;
}

/** Decides what unapplied slips do to the sheet. Re-running with the same input does nothing new. */
export function planSlipReconcile(slips: SlipFact[], view: LedgerView): SlipPlan {
  const rowsById = new Map(view.rows.map(r => [r.id, r]));
  const links = linksByRow(view.cards);
  const plan: SlipPlan = { ops: [], results: [], cardLinks: [] };

  const open: SlipFact[] = [];
  for (const slip of slips) {
    const written = view.rows.find(r => r.driveFileId === slip.driveFileId);
    if (written) plan.results.push({ driveFileId: slip.driveFileId, txId: written.id, outcome: 'already' });
    else open.push(slip);
  }

  const assigned = assignSlips(open.flatMap(s => findCandidates(s, view, rowsById, links)));
  const handled = new Set(assigned.map(c => c.slip.driveFileId));
  const usedRows = new Set(assigned.map(c => c.row.id));

  for (const { slip, card, row, kind } of assigned) {
    if (!isAutomationOwned(row)) {
      plan.results.push({ driveFileId: slip.driveFileId, txId: row.id, outcome: 'protected' });
      continue;
    }

    const destination = slip.type === 'TRANSFER' ? slipDestination(slip) : null;
    const record = (txId: string, outcome: SlipOutcome) =>
      plan.results.push({ driveFileId: slip.driveFileId, txId, outcome });

    if (kind === 'adopt') {
      const adopted = rowWithSlip({ ...row, account: slip.account }, slip, card.account);
      plan.ops.push(updateOp(adopted));
      record(row.id, 'adopted');
      continue;
    }

    if (kind === 'single') {
      if (slip.type === 'TRANSFER' && destination) {
        absorbLoneDeposit(slip, destination, row, view, rowsById, links, usedRows, plan);
      }
      plan.ops.push(updateOp(rowWithSlip(row, slip, destination)));
      record(row.id, slip.type === row.type ? 'merged' : 'corrected');
      continue;
    }

    // A provisional pair of two cards
    const [outCard, inCard] = sortPair(links.get(row.id) || []);
    const confirmed = slip.type === 'TRANSFER' && card.direction === 'OUT' && (destination === null || destination === inCard.account);
    if (confirmed) {
      plan.ops.push(updateOp(rowWithSlip(row, slip, inCard.account)));
      record(row.id, 'confirmed');
      continue;
    }

    const other = card === outCard ? inCard : outCard;
    const cardRowIdOf = (c: StoredCard) => cardRowId(c.key);
    const rowBelongsToOther = row.id === cardRowIdOf(other);
    const slipRow = rowWithSlip(pendingRowForCard(card), slip, destination);
    const otherRow = pendingRowForCard(other);

    // The write that carries the slip's id goes last: until it lands the slip counts as unapplied,
    // so a crash halfway through is simply planned again
    if (rowBelongsToOther) {
      plan.ops.push(updateOp({ ...otherRow, id: row.id }));
      plan.ops.push({ kind: 'append', row: slipRow });
      plan.cardLinks.push({ key: card.key, txId: slipRow.id });
      record(slipRow.id, 'undone');
    } else {
      const slipRowInPlace = { ...slipRow, id: row.id };
      if (!rowsById.has(otherRow.id)) plan.ops.push({ kind: 'append', row: otherRow });
      plan.ops.push(updateOp(slipRowInPlace));
      plan.cardLinks.push({ key: other.key, txId: otherRow.id });
      record(row.id, 'undone');
    }
  }

  for (const slip of open) {
    if (handled.has(slip.driveFileId)) continue;
    const destination = slip.type === 'TRANSFER' ? slipDestination(slip) : null;
    const row: LineRow = {
      id: `tx_${sha1(slip.driveFileId).slice(0, 20)}`,
      date: slip.date,
      time: slip.time,
      type: slip.type,
      amount: slip.amount,
      category: slip.category,
      account: slip.account,
      note: destination ? slipTransferNote(slip, destination) : slip.note,
      slipUrl: slip.slipUrl,
      driveFileId: slip.driveFileId,
      source: 'AUTO_SYNC',
    };
    plan.ops.push({ kind: 'append', row });
    plan.results.push({ driveFileId: slip.driveFileId, txId: row.id, outcome: 'appended' });
  }

  return plan;
}

function sortPair(cards: StoredCard[]): [StoredCard, StoredCard] {
  const out = cards.find(c => c.direction === 'OUT')!;
  const inCard = cards.find(c => c.direction === 'IN')!;
  return [out, inCard];
}

/**
 * A self-transfer slip was merged on the sender while the in card sits alone on the receiver (the
 * cards were too far apart to pair). The transfer row already credits the receiver, so that row goes.
 */
function absorbLoneDeposit(
  slip: SlipFact,
  destination: string,
  merged: LineRow,
  view: LedgerView,
  rowsById: Map<string, LineRow>,
  links: Map<string, StoredCard[]>,
  usedRows: Set<string>,
  plan: SlipPlan,
): void {
  for (const card of view.cards) {
    if (card.account !== destination || card.direction !== 'IN') continue;
    if (!sameAmount(card.amount, slip.amount) || minutesApart(card, slip) > SLIP_MATCH_MINUTES) continue;
    const row = rowsById.get(card.txId);
    if (!row || usedRows.has(row.id) || !isOpen(row) || (links.get(row.id) || []).length !== 1) continue;
    usedRows.add(row.id);
    plan.ops.push({ kind: 'delete', id: row.id });
    plan.cardLinks.push({ key: card.key, txId: merged.id });
    return;
  }
}
