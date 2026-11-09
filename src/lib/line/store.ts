// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { appendTransactionRows, deleteRowsById, getAllTransactions, updateRowsById } from '../db/transactions.ts';
import {
  findLineCard,
  listRecentLineCards,
  listUnappliedSlipFacts,
  markSlipFactsApplied,
  recordLineAlerts,
  relinkLineCards,
  resolveLineAlerts,
  saveLineCard,
  withLedgerLock,
  // @ts-expect-error - node test runner requires .ts extension for ESM strip-types
} from '../db/line-ledger.ts';
import type { LedgerStore } from './ingest.ts';
import type { Transaction } from '../../types/index.ts';

/** The LINE ledger on Postgres */
export const ledgerStore: LedgerStore = {
  withLock: withLedgerLock,
  readRows: getAllTransactions,
  findCard: findLineCard,
  listCards: listRecentLineCards,
  saveCard: saveLineCard,
  relinkCards: relinkLineCards,
  appendRows: async rows => {
    const createdAt = new Date().toISOString();
    await appendTransactionRows(rows.map(row => ({ ...row, source: row.source as Transaction['source'], createdAt })));
  },
  updateRows: updateRowsById,
  deleteRows: deleteRowsById,
  unappliedSlips: listUnappliedSlipFacts,
  markSlipsApplied: markSlipFactsApplied,
  recordAlerts: recordLineAlerts,
  resolveAlerts: resolveLineAlerts,
};
