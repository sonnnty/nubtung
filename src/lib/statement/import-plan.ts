// Decides which sheet rows a statement import adds (email path) or rewrites (Drive path).
// No `@/` imports here: this module is loaded directly by the node test runner.
//
// Rules:
// - A statement row matches an existing row on the statement's own account with the same date and
//   amount (slip-first: the existing row stays as it is). Each existing row matches once.
// - A transfer between two tracked accounts is stored once: as a TRANSFER on the *sending* account
//   whose note resolves (see resolveTransferDestination) to the receiving account.
//   * Sending side ("โอนไป X2996" on K PLUS): an ordinary statement row on the sender, so it also
//     matches the row the receiving side may have added earlier.
//   * Receiving side ("รับโอนเงิน จาก X6651" on Make): adds nothing if a TRANSFER or slip row with
//     the same date and amount exists on the sending or the receiving account; otherwise adds one
//     TRANSFER on the sending account.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { resolveTransferDestination } from '../balance/transfer-destination.ts';
import type { StatementTransaction } from './statement-text.ts';

export type TxType = 'EXPENSE' | 'INCOME' | 'TRANSFER';

/** The parts of an existing sheet row the matching needs */
export interface LedgerRow {
  date: string;
  amount: number;
  type: TxType;
  account: string;
  slipUrl?: string;
  driveFileId?: string;
  source?: string;
}

export interface StatementImport {
  account: string;
  transactions: StatementTransaction[];
}

export interface PlannedRow {
  date: string;
  time: string;
  type: TxType;
  amount: number;
  category: string;
  account: string;
  note: string;
}

export interface ImportPlan {
  toAppend: PlannedRow[];
  /** Statement rows that matched a row already in the sheet */
  matched: number;
}

const TRANSFER_CATEGORY = 'โอนระหว่างบัญชี';

/** A deposit that came from another tracked account of mine (the receiving side of a transfer) */
export function isInternalReceipt(stm: StatementTransaction): boolean {
  return stm.direction === 'IN' && stm.type === 'TRANSFER' && !!stm.counterparty;
}

export function internalTransferNote(from: string, to: string, details?: string): string {
  const base = `โอนจาก ${from} ไปยัง ${to} (statement)`;
  if (details) {
    const withDetails = `${base} — ${details}`;
    if (resolveTransferDestination(withDetails, from) === to) return withDetails;
  }
  return base;
}

/**
 * Note for a statement row stored on its own account. The statement details are kept as they are
 * unless this is a transfer to a tracked account whose details the balance calc would resolve to
 * the wrong account (e.g. "MAKE by KBank ... โอนไป X6651" reads as Make).
 */
export function statementRowNote(stm: StatementTransaction): string {
  const note = stm.details || stm.typeDesc || 'KBank e-Statement';
  if (
    stm.type === 'TRANSFER' &&
    stm.direction === 'OUT' &&
    stm.counterparty &&
    resolveTransferDestination(note, stm.channel) !== stm.counterparty
  ) {
    return internalTransferNote(stm.channel, stm.counterparty, note);
  }
  return note;
}

function isSlipRow(row: LedgerRow): boolean {
  return !!(row.driveFileId && row.driveFileId.trim()) ||
    !!(row.slipUrl && row.slipUrl.trim() && row.slipUrl.trim() !== '-') ||
    (row.source || '').startsWith('AUTO_SYNC');
}

interface PoolEntry<R extends LedgerRow> {
  row: R;
  /** Matched by a row of a statement of the row's own account */
  claimedOwn: boolean;
  /** Matched by the receiving side of an internal transfer (a statement of another account) */
  claimedOther: boolean;
  /** Only these rows may satisfy a receipt on the receiving account (see reconcile) */
  receiptCandidate: boolean;
}

class RowPool<R extends LedgerRow> {
  private byKey = new Map<string, PoolEntry<R>[]>();

  private key(account: string, date: string, amount: number) {
    return `${account}|${date}|${amount.toFixed(2)}`;
  }

  add(row: R, flags: Partial<Omit<PoolEntry<R>, 'row'>> = {}): PoolEntry<R> {
    const entry: PoolEntry<R> = { row, claimedOwn: false, claimedOther: false, receiptCandidate: true, ...flags };
    const k = this.key(row.account, row.date, row.amount);
    const list = this.byKey.get(k);
    if (list) list.push(entry);
    else this.byKey.set(k, [entry]);
    return entry;
  }

  /** Match a statement row of `account` itself; `sameKind` only takes rows of the same TRANSFER-ness */
  claimOwn(account: string, date: string, amount: number, isTransfer: boolean, sameKind: boolean): PoolEntry<R> | null {
    const entry = (this.byKey.get(this.key(account, date, amount)) || [])
      .find(e => !e.claimedOwn && (!sameKind || (e.row.type === 'TRANSFER') === isTransfer));
    if (!entry) return null;
    entry.claimedOwn = true;
    return entry;
  }

  /** Match the receiving side of an internal transfer against TRANSFER / slip rows */
  claimForReceipt(sender: string, receiver: string, date: string, amount: number): PoolEntry<R> | null {
    const isTransferOrSlip = (e: PoolEntry<R>) => e.row.type === 'TRANSFER' || isSlipRow(e.row);
    const onSender = (this.byKey.get(this.key(sender, date, amount)) || [])
      .find(e => !e.claimedOther && isTransferOrSlip(e));
    if (onSender) {
      onSender.claimedOther = true;
      return onSender;
    }
    const onReceiver = (this.byKey.get(this.key(receiver, date, amount)) || [])
      .find(e => !e.claimedOwn && e.receiptCandidate && isTransferOrSlip(e));
    if (onReceiver) {
      onReceiver.claimedOwn = true;
      return onReceiver;
    }
    return null;
  }
}

interface StatementLine {
  account: string;
  stm: StatementTransaction;
  index: number;
}

/**
 * Drops rows a statement shares with an earlier one (overlapping periods). Identical rows inside
 * one statement are kept: they are separate transactions (two equal payments in the same minute).
 */
function dedupeAcrossStatements(statements: StatementImport[]): StatementImport[] {
  const seen = new Set<string>();
  return statements.map(s => {
    const mine = new Set<string>();
    const transactions = s.transactions.filter(tx => {
      const fp = `${s.account}_${tx.date}_${tx.time}_${tx.amount.toFixed(2)}_${tx.type}_${tx.details.substring(0, 30)}`;
      mine.add(fp);
      return !seen.has(fp);
    });
    for (const fp of mine) seen.add(fp);
    return { account: s.account, transactions };
  });
}

/** Statement rows in order, split into rows of the statement's own account and receipts of internal transfers */
function splitLines(statements: StatementImport[]) {
  const lines: StatementLine[] = [];
  for (const s of dedupeAcrossStatements(statements)) {
    for (const stm of s.transactions) lines.push({ account: s.account, stm, index: lines.length });
  }
  return {
    lines,
    own: lines.filter(l => !isInternalReceipt(l.stm)),
    receipts: lines.filter(l => isInternalReceipt(l.stm)),
  };
}

/**
 * Matches own-account statement rows to existing rows: first only against rows of the same kind
 * (TRANSFER or not), then against any row left. So "โอนไป X2996 750" takes the TRANSFER row a
 * receipt added, not an unrelated 750 expense on the same day that the statement also lists.
 */
function claimOwnRows<R extends LedgerRow>(pool: RowPool<R>, own: StatementLine[]): Map<number, PoolEntry<R>> {
  const claims = new Map<number, PoolEntry<R>>();
  for (const sameKind of [true, false]) {
    for (const line of own) {
      if (claims.has(line.index)) continue;
      const { stm } = line;
      const entry = pool.claimOwn(line.account, stm.date, stm.amount, stm.type === 'TRANSFER', sameKind);
      if (entry) claims.set(line.index, entry);
    }
  }
  return claims;
}

function receiptRow(line: StatementLine): PlannedRow {
  const sender = line.stm.counterparty!;
  return {
    date: line.stm.date,
    time: line.stm.time,
    type: 'TRANSFER',
    amount: line.stm.amount,
    category: TRANSFER_CATEGORY,
    account: sender,
    note: internalTransferNote(sender, line.account, line.stm.details),
  };
}

/**
 * Email path: which rows to append for newly received statements, given every row in the sheet.
 * Rows with an empty account count as K PLUS, as before.
 */
export function planStatementImport(existing: LedgerRow[], statements: StatementImport[]): ImportPlan {
  const pool = new RowPool<LedgerRow>();
  for (const row of existing) {
    pool.add({ ...row, account: row.account || 'K PLUS' });
  }

  const { own, receipts } = splitLines(statements);
  const claims = claimOwnRows(pool, own);
  const added: Array<{ index: number; row: PlannedRow }> = [];
  let matched = claims.size;

  for (const line of own) {
    if (claims.has(line.index)) continue;
    const { stm } = line;
    const row: PlannedRow = {
      date: stm.date,
      time: stm.time,
      type: stm.type,
      amount: stm.amount,
      category: stm.category || 'อื่นๆ',
      account: line.account,
      note: statementRowNote(stm),
    };
    added.push({ index: line.index, row });
    pool.add(row, { claimedOwn: true });
  }

  for (const line of receipts) {
    const { stm } = line;
    if (pool.claimForReceipt(stm.counterparty!, line.account, stm.date, stm.amount)) {
      matched++;
      continue;
    }
    const row = receiptRow(line);
    added.push({ index: line.index, row });
    // Left unclaimed on the sender's side, so the sender's own statement matches it later
    pool.add(row, { claimedOther: true });
  }

  added.sort((a, b) => a.index - b.index);
  return { toAppend: added.map(a => a.row), matched };
}

// ---------------------------------------------------------------------------------------------
// Drive path: rewrite the rows of each statement's account from its statements

/** A sheet row, columns A–K: date, time, type label, amount, category, account, note, slip, id, driveFileId, source */
export type SheetRow = Array<string | number>;

export function typeLabel(type: TxType): string {
  if (type === 'INCOME') return '🟢 รายรับ';
  if (type === 'TRANSFER') return '🔄 โอนย้ายเงิน';
  return '🔴 รายจ่าย';
}

function sheetRowToLedger(row: SheetRow): LedgerRow & { sheetRow: SheetRow } {
  const label = String(row[2] || '');
  let type: TxType = 'EXPENSE';
  if (label.includes('รายรับ') || label === 'INCOME') type = 'INCOME';
  else if (label.includes('โอนย้าย') || label === 'TRANSFER') type = 'TRANSFER';
  return {
    date: String(row[0] || ''),
    amount: parseFloat(String(row[3] || '0').replace(/[^\d.-]/g, '')),
    type,
    account: String(row[5] || '').trim(),
    slipUrl: String(row[7] || ''),
    driveFileId: String(row[9] || ''),
    source: String(row[10] || ''),
    sheetRow: row,
  };
}

export interface ReconcileResult {
  rows: SheetRow[];
  /** Per statement account: statement rows written, and how many of them kept an existing slip */
  perAccount: Record<string, { total: number; matched: number }>;
  /** TRANSFER rows added on a sending account for receipts nothing matched */
  addedTransfers: number;
  /** Rows of accounts without a statement in this run, left as they were */
  untouched: number;
}

/**
 * Rewrites the rows of every account that has statements from those statements, keeping each
 * matched row's slip / id, and keeping that account's unmatched rows (e.g. slips newer than the
 * statement). Rows of any other account are never rewritten; the only rows added to another
 * account are the sending side of internal transfers no row matched.
 */
export function reconcileStatementRows(existingRows: SheetRow[], statements: StatementImport[]): ReconcileResult {
  const statementAccounts = new Set(statements.map(s => s.account));

  const ownPool = new RowPool<LedgerRow & { sheetRow: SheetRow }>();
  const untouchedRows: SheetRow[] = [];
  const ownEntries: Array<PoolEntry<LedgerRow & { sheetRow: SheetRow }>> = [];
  for (const row of existingRows) {
    const ledger = sheetRowToLedger(row);
    if (statementAccounts.has(ledger.account) && ledger.date && !isNaN(ledger.amount)) {
      ownEntries.push(ownPool.add(ledger));
    } else {
      untouchedRows.push(row);
    }
  }

  const { lines, own, receipts } = splitLines(statements);
  const claims = claimOwnRows(ownPool, own);
  const written = new Map<number, SheetRow>();
  const perAccount: ReconcileResult['perAccount'] = {};
  for (const acc of statementAccounts) perAccount[acc] = { total: 0, matched: 0 };

  for (const line of own) {
    const { stm } = line;
    const entry = claims.get(line.index);
    const slip = entry ? entry.row.sheetRow : null;
    const slipCell = slip && slip[7] && slip[7] !== '-' ? slip[7] : '-';
    written.set(line.index, [
      stm.date,
      stm.time,
      typeLabel(stm.type),
      stm.amount,
      stm.category,
      line.account,
      statementRowNote(stm),
      slipCell,
      slip && slip[8] ? slip[8] : `stm_${stm.date.replace(/-/g, '')}_${line.index + 1}`,
      slip && slip[9] ? slip[9] : '',
      slip ? 'AUTO_SYNC+STATEMENT' : 'STATEMENT',
    ]);
    perAccount[line.account].total++;
    if (slip) perAccount[line.account].matched++;
  }

  const rewritten = lines.filter(l => written.has(l.index)).map(l => written.get(l.index)!);
  const keptUnmatched = ownEntries.filter(e => !e.claimedOwn).map(e => e.row.sheetRow);

  // Receipts are checked against the rows as they will be written. On the receiving account only
  // the rows kept unmatched count: the rewritten ones are other statement rows.
  const receiptPool = new RowPool<LedgerRow>();
  for (const row of rewritten) receiptPool.add(sheetRowToLedger(row), { receiptCandidate: false });
  for (const row of [...keptUnmatched, ...untouchedRows]) receiptPool.add(sheetRowToLedger(row));

  const addedRows: SheetRow[] = [];
  for (const line of receipts) {
    const { stm } = line;
    if (receiptPool.claimForReceipt(stm.counterparty!, line.account, stm.date, stm.amount)) continue;
    const planned = receiptRow(line);
    const row: SheetRow = [
      planned.date,
      planned.time,
      typeLabel(planned.type),
      planned.amount,
      planned.category,
      planned.account,
      planned.note,
      '-',
      `stm_${stm.date.replace(/-/g, '')}_${line.index + 1}`,
      '',
      'STATEMENT',
    ];
    addedRows.push(row);
    receiptPool.add(sheetRowToLedger(row), { claimedOther: true });
  }

  const rows = [...rewritten, ...keptUnmatched, ...addedRows, ...untouchedRows];
  rows.sort((a, b) => `${b[0] || ''} ${b[1] || ''}`.localeCompare(`${a[0] || ''} ${a[1] || ''}`));

  return { rows, perAccount, addedTransfers: addedRows.length, untouched: untouchedRows.length };
}
