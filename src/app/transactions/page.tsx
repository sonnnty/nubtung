'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import TransactionTable from '@/components/Transactions/TransactionTable';
import ManualTransactionModal from '@/components/Transactions/ManualTransactionModal';
import { Alert, Button } from '@/components/ui';
import { Transaction } from '@/types';
import { readJson } from '@/lib/utils/http';

interface LineAlertView {
  id: string;
  message: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineAlerts, setLineAlerts] = useState<LineAlertView[]>([]);

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
      setLineAlerts(data.lineAlerts || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการธุรกรรมได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load via shared fetchTransactions callback
    fetchTransactions();
  }, [fetchTransactions]);

  return (
    <div className="min-h-screen flex flex-col bg-canvas transition-colors">
      <Navbar onSyncComplete={fetchTransactions} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6 pb-28 md:pb-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">
              รายการธุรกรรมทั้งหมด (Transactions)
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted mt-1">
              ค้นหา กรอง และดูสลิปของทุกรายการได้ที่นี่ (Google Sheet เป็นสำเนาสำหรับให้คนอื่นดู)
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2.5">
            <ManualTransactionModal onSuccess={fetchTransactions} />
          </div>
        </div>

        {error && (
          <Alert
            variant="warning"
            title="ข้อความแจ้งเตือน"
            action={
              <Button variant="secondary" size="sm" onClick={fetchTransactions}>
                ลองใหม่
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {lineAlerts.length > 0 && (
          <Alert
            variant="warning"
            title={`การ์ด LINE ต้องตรวจสอบ ${lineAlerts.length} รายการ`}
          >
            <ul className="space-y-1 list-disc list-inside text-xs">
              {lineAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id}>{alert.message}</li>
              ))}
            </ul>
          </Alert>
        )}

        <TransactionTable
          transactions={transactions}
          loading={loading}
          onRefresh={fetchTransactions}
        />
      </main>

      <MobileBottomNav onSyncComplete={fetchTransactions} onRefresh={fetchTransactions} />
    </div>
  );
}
