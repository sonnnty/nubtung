'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Home,
  RefreshCw,
  Plus,
  ShieldCheck,
  AlertCircle,
  CheckCircle,
  Layers,
} from 'lucide-react';
import MortgageOverviewCards from './MortgageOverviewCards';
import MortgageCharts from './MortgageCharts';
import MortgageSimulator from './MortgageSimulator';
import MortgageHistoryTable from './MortgageHistoryTable';
import ManualPaymentModal from './ManualPaymentModal';
import { DEFAULT_INTEREST_CONFIG } from '@/lib/mortgage/types';
import type { MortgageSummary, MortgagePayment } from '@/lib/mortgage/types';
import { readJson } from '@/lib/utils/http';

type AccountTab = 'ALL' | '011690010474' | '011690010482';

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

export default function MortgageDashboard() {
  const [selectedTab, setSelectedTab] = useState<AccountTab>('ALL');
  const [summary, setSummary] = useState<MortgageSummary | null>(null);
  const [payments, setPayments] = useState<MortgagePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Fetch mortgage data from API
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/mortgage');
      const data = await readJson(res);

      if (data.success) {
        setSummary(data.summary);
        setPayments(data.payments || []);
      } else {
        throw new Error(data.error || 'Failed to fetch mortgage summary');
      }
    } catch (err: unknown) {
      console.error('Error fetching mortgage data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch('/api/mortgage');
        const data = await readJson(res);
        if (!ignore && data.success) {
          setSummary(data.summary);
          setPayments(data.payments || []);
        }
      } catch (err: unknown) {
        console.error('Error fetching mortgage data:', err);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Handle GH Bank Email Sync
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setToast(null);

    try {
      const res = await fetch('/api/mortgage/sync', { method: 'POST' });
      const data = await readJson(res);

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'การซิงค์ข้อมูลจากอีเมลล้มเหลว');
      }

      if (data.addedCount > 0) {
        setToast({
          type: 'success',
          message: `ซิงค์สำเร็จ! พบใบเสร็จ ธอส. ใหม่ ${data.addedCount} รายการ`,
        });
      } else {
        setToast({
          type: 'success',
          message: 'ข้อมูลเป็นปัจจุบันแล้ว (ไม่พบใบเสร็จใหม่ในอีเมล)',
        });
      }

      await fetchData();
    } catch (err: unknown) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่ออีเมล ธอส.',
      });
    } finally {
      setSyncing(false);
      setTimeout(() => {
        setToast(null);
      }, 5000);
    }
  };

  // Filter payments based on selected account tab
  const filteredPayments =
    selectedTab === 'ALL'
      ? payments
      : payments.filter((p) => p.accountId === selectedTab);

  // Selected account metadata for simulator
  const activeAccount =
    selectedTab === 'ALL'
      ? null
      : summary?.accounts.find((a) => a.id === selectedTab);

  const simulatorBalance =
    selectedTab === 'ALL'
      ? summary?.totalRemainingBalance || 2200023
      : activeAccount?.remainingBalance || (selectedTab === '011690010474' ? 2100000 : 100023);

  const simulatorConfig = activeAccount?.interestConfig || DEFAULT_INTEREST_CONFIG;
  const simulatorName =
    selectedTab === 'ALL'
      ? 'ภาพรวมสินเชื่อทั้งหมด (2 สัญญา)'
      : activeAccount?.name || 'สินเชื่อบ้าน';

  const simulatorBasePayment =
    selectedTab === 'ALL' ? 9500 : selectedTab === '011690010482' ? 600 : 8500;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification Banner */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-2xl shadow-2xl border max-w-md animate-in fade-in slide-in-from-top-3 duration-200 flex items-center gap-3 ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-800'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Header Section with Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              ติดตามการผ่อนบ้าน (Mortgage Tracker)
            </h1>
            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              ธอส. 2.2M
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            ธนาคารอาคารสงเคราะห์ • บัญชีบ้านหลัก (2.1M) & ประกัน MRTA (100k)
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Sync Button */}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold shadow-md transition-all active:scale-95 text-white ${
              syncing
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
            }`}
            title="เชื่อมต่อและดึงใบเสร็จรับเงิน PDF ล่าสุดจาก Gmail"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'กำลังซิงค์อีเมล...' : 'Sync จากอีเมล ธอส.'}</span>
          </button>

          {/* Manual Entry Button */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-xs transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>+ บันทึกด้วยตนเอง</span>
          </button>
        </div>
      </div>

      {/* Account Switcher Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800/70 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 overflow-x-auto">
        <button
          type="button"
          onClick={() => setSelectedTab('ALL')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
            selectedTab === 'ALL'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-emerald-500" />
          <span>ภาพรวมทั้งหมด (2.2M)</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('011690010474')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
            selectedTab === '011690010474'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Home className="w-3.5 h-3.5 text-teal-500" />
          <span>สินเชื่อบ้านหลัก (2.1M)</span>
          <span className="text-[10px] text-slate-400 font-normal">#011690010474</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('011690010482')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
            selectedTab === '011690010482'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
          <span>สินเชื่อ MRTA (100k)</span>
          <span className="text-[10px] text-slate-400 font-normal">#011690010482</span>
        </button>
      </div>

      {/* 1. KPI Overview Summary Cards */}
      <MortgageOverviewCards
        summary={summary}
        selectedAccountId={selectedTab}
        loading={loading}
      />

      {/* 2. Visualizations (Stacked Bar & Balance Reduction) */}
      <MortgageCharts payments={filteredPayments} loading={loading} />

      {/* 3. Interactive Extra Payment Simulator */}
      <MortgageSimulator
        key={selectedTab}
        currentBalance={simulatorBalance}
        interestConfig={simulatorConfig}
        accountName={simulatorName}
        defaultBasePayment={simulatorBasePayment}
      />

      {/* 4. Payment History Table with Actions */}
      <MortgageHistoryTable
        payments={filteredPayments}
        loading={loading}
        onRefresh={fetchData}
      />

      {/* 5. Manual Payment Modal Dialog */}
      <ManualPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchData}
        defaultAccountId={selectedTab === 'ALL' ? '011690010474' : selectedTab}
      />
    </div>
  );
}
