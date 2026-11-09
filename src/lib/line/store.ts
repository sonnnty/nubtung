import { appendTransactionRows, deleteRowsById, getAllTransactions, updateRowsById } from '@/lib/google/sheets';
import {
  commitRowFingerprints,
  findLineCard,
  listRecentLineCards,
  listUnappliedSlipFacts,
  markSlipFactsApplied,
  prepareRowFingerprints,
  readRowFingerprints,
  recordLineAlerts,
  relinkLineCards,
  resolveLineAlerts,
  saveLineCard,
  withLedgerLock,
} from '@/lib/db/line-ledger';
import type { LedgerStore } from '@/lib/line/ingest';
import type { Transaction } from '@/types';

/** The LINE ledger, on the real sheet and Postgres */
export const ledgerStore: LedgerStore = {
  withLock: withLedgerLock,
  readRows: getAllTransactions,
  findCard: findLineCard,
  listCards: listRecentLineCards,
  saveCard: saveLineCard,
  relinkCards: relinkLineCards,
  readFingerprints: readRowFingerprints,
  prepareFingerprints: prepareRowFingerprints,
  commitFingerprints: commitRowFingerprints,
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
