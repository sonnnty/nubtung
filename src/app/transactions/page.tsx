'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import TransactionTable from '@/components/Transactions/TransactionTable';
import ManualTransactionModal from '@/components/Transactions/ManualTransactionModal';
import { Transaction } from '@/types';
import { readJson } from '@/lib/utils/http';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/transactions');
      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch transactions');
      }
      setTransactions(data.transactions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0b0f19] transition-colors">
      <Navbar onSyncComplete={fetchTransactions} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6 pb-28 md:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              รายการธุรกรรมทั้งหมด (Transactions)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1">
              ข้อมูลทั้งหมดในแท็บ '📝 รายการทั้งหมด' บน Google Sheets สามารถค้นหา กรอง และดูสลิปได้
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            <ManualTransactionModal onSuccess={fetchTransactions} />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between">
            <div>
              <span className="font-bold">ข้อความแจ้งเตือน: </span>
              <span>{error}</span>
            </div>
            <button
              onClick={fetchTransactions}
              className="px-3 py-1 bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 text-amber-900 dark:text-amber-100 rounded-xl font-medium transition-colors"
            >
              ลองใหม่
            </button>
          </div>
        )}

        <TransactionTable transactions={transactions} loading={loading} onRefresh={fetchTransactions} />
      </main>

      <MobileBottomNav onSyncComplete={fetchTransactions} onRefresh={fetchTransactions} />
    </div>
  );
}
