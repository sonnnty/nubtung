import { appendTransactionRows, deleteRowsById, getAllTransactions, updateRowsById } from '@/lib/db/transactions';
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
} from '@/lib/db/line-ledger';
import type { LedgerStore } from '@/lib/line/ingest';
import type { Transaction } from '@/types';

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
