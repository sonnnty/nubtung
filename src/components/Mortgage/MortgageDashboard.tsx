'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Home,
  RefreshCw,
  Plus,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import MortgageOverviewCards from './MortgageOverviewCards';
import MortgageCharts from './MortgageCharts';
import MortgageSimulator from './MortgageSimulator';
import MortgageHistoryTable from './MortgageHistoryTable';
import ManualPaymentModal from './ManualPaymentModal';
import { Badge, Button } from '@/components/ui';
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
          message: `ซิงค์สำเร็จ พบใบเสร็จ ธอส. ใหม่ ${data.addedCount} รายการ`,
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

  const filteredPayments =
    selectedTab === 'ALL'
      ? payments
      : payments.filter((p) => p.accountId === selectedTab);

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
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed top-18 right-4 z-50 p-3.5 rounded-card shadow-popover border max-w-md w-[calc(100%-2rem)] sm:w-auto flex items-center gap-2.5 bg-surface ${
            toast.type === 'success' ? 'border-income-border' : 'border-expense-border'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-income shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-expense shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-medium text-ink">{toast.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              ติดตามการผ่อนบ้าน
            </h1>
            <Badge variant="accent">ธอส. 2.2M</Badge>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted mt-1">
            ธนาคารอาคารสงเคราะห์ · บัญชีบ้านหลัก (2.1M) และประกัน MRTA (100k)
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            title="เชื่อมต่อและดึงใบเสร็จรับเงิน PDF ล่าสุดจาก Gmail"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'กำลังซิงค์อีเมล...' : 'ซิงค์จากอีเมล ธอส.'}</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>บันทึกด้วยตนเอง</span>
          </Button>
        </div>
      </div>

      {/* Account Switcher Tabs */}
      <div
        role="tablist"
        aria-label="เลือกบัญชีสินเชื่อ"
        className="flex items-center gap-1 p-1 bg-surface-subtle rounded-control border border-border overflow-x-auto no-scrollbar"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedTab === 'ALL'}
          onClick={() => setSelectedTab('ALL')}
          className={`min-h-9 flex items-center gap-2 px-3.5 py-1.5 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
            selectedTab === 'ALL'
              ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
              : 'text-ink-secondary hover:text-ink border border-transparent'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span>ภาพรวมทั้งหมด (2.2M)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedTab === '011690010474'}
          onClick={() => setSelectedTab('011690010474')}
          className={`min-h-9 flex items-center gap-2 px-3.5 py-1.5 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
            selectedTab === '011690010474'
              ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
              : 'text-ink-secondary hover:text-ink border border-transparent'
          }`}
        >
          <Home className="w-3.5 h-3.5 shrink-0" />
          <span>สินเชื่อบ้านหลัก (2.1M)</span>
          <span className="text-[11px] font-mono text-ink-muted">#011690010474</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedTab === '011690010482'}
          onClick={() => setSelectedTab('011690010482')}
          className={`min-h-9 flex items-center gap-2 px-3.5 py-1.5 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
            selectedTab === '011690010482'
              ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
              : 'text-ink-secondary hover:text-ink border border-transparent'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>สินเชื่อ MRTA (100k)</span>
          <span className="text-[11px] font-mono text-ink-muted">#011690010482</span>
        </button>
      </div>

      {/* 1. KPI Overview Summary Cards */}
      <MortgageOverviewCards
        summary={summary}
        selectedAccountId={selectedTab}
        loading={loading}
      />

      {/* 2. Visualizations */}
      <MortgageCharts payments={filteredPayments} loading={loading} />

      {/* 3. Interactive Extra Payment Simulator */}
      <MortgageSimulator
        key={selectedTab}
        currentBalance={simulatorBalance}
        interestConfig={simulatorConfig}
        accountName={simulatorName}
        defaultBasePayment={simulatorBasePayment}
      />

      {/* 4. Payment History Table */}
      <MortgageHistoryTable
        payments={filteredPayments}
        loading={loading}
        onRefresh={fetchData}
      />

      {/* 5. Manual Payment Modal */}
      <ManualPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchData}
        defaultAccountId={selectedTab === 'ALL' ? '011690010474' : selectedTab}
      />
    </div>
  );
}
