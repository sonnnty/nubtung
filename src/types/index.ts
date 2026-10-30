export type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER';

export type AccountType = 'K PLUS' | 'Make by KBank' | 'เงินสด' | 'อื่นๆ';

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  type: TransactionType;
  amount: number;
  category: string;
  account: string;
  note: string;
  slipUrl?: string;
  driveFileId?: string;
  source: 'AUTO_SYNC' | 'MANUAL' | 'STATEMENT';
  createdAt: string;
}

export interface SlipAnalysisResult {
  amount: number;
  date: string;
  time: string;
  senderName?: string;
  receiverName?: string;
  receiverAccount?: string;
  category: string;
  note: string;
  isSelfTransfer: boolean;
  type: TransactionType;
}

export interface SyncStats {
  processed: number;
  skipped: number;
  failed: number;
  transfers: number;
  details: Array<{
    fileName: string;
    account: string;
    amount?: number;
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    error?: string;
  }>;
}

export interface DashboardSummary {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  transferTotal: number;
  accountBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  recentTransactions: Transaction[];
  accountBalances?: Record<string, number>;
  /** Accounts whose balance starts from a statement closing balance -> statement period end (YYYY-MM-DD) */
  accountBalanceAsOf?: Record<string, string>;
  totalCashInAccounts?: number;
}

export interface UserSession {
  id: string;
  username: string;
}
