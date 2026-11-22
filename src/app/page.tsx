'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import SummaryCards from '@/components/Dashboard/SummaryCards';
import PeriodSelector, { PeriodMode, getSalaryCycleRange } from '@/components/Dashboard/PeriodSelector';
import TrendChart, { ChartDataPoint } from '@/components/Dashboard/TrendChart';
import CategoryPieChart from '@/components/Dashboard/CategoryPieChart';
import ManualTransactionModal from '@/components/Transactions/ManualTransactionModal';
import { Alert, Badge, Button, Card, CardFooter, formatMoney } from '@/components/ui';
import { Transaction, DashboardSummary } from '@/types';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronLeft,
  ExternalLink,
} from 'lucide-react';
import { readJson } from '@/lib/utils/http';
import { summarizeTransactions } from '@/lib/summary/totals';
import { isBalanceAdjustment, withoutBalanceAdjustments } from '@/lib/balance/balance-adjustment';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export default function DashboardPage() {
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [overallSummary, setOverallSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Period Selector State (Default: MONTH with Salary Cycle)
  const [periodMode, setPeriodMode] = useState<PeriodMode>('MONTH');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [useSalaryCycle, setUseSalaryCycle] = useState<boolean>(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/transactions');
      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch transactions');
      }
      setAllTransactions(data.transactions || []);
      setOverallSummary(data.summary || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลรายการได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load via shared fetchData callback
    fetchData();
  }, [fetchData]);

  // Filter and sort transactions based on active Period Mode and selected Date (strictly latest first)
  const filteredTransactions = useMemo(() => {
    let list: Transaction[] = [];
    if (periodMode === 'ALL') {
      list = [...allTransactions];
    } else {
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const date = selectedDate.getDate();

      list = allTransactions.filter((tx) => {
        if (!tx.date) return false;
        const [txY, txM, txD] = tx.date.split('-').map(Number);
        if (!txY || !txM || !txD) return false;

        const txDate = new Date(txY, txM - 1, txD);

        if (periodMode === 'YEAR') {
          return txY === year;
        }
        if (periodMode === 'MONTH') {
          if (useSalaryCycle) {
            const { startDate, endDate } = getSalaryCycleRange(selectedDate, 26);
            return txDate >= startDate && txDate <= endDate;
          }
          return txY === year && txM - 1 === month;
        }
        if (periodMode === 'WEEK') {
          const startOfWeek = new Date(selectedDate);
          const day = startOfWeek.getDay() || 7;
          startOfWeek.setDate(startOfWeek.getDate() - day + 1);
          startOfWeek.setHours(0, 0, 0, 0);

          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          return txDate >= startOfWeek && txDate <= endOfWeek;
        }
        if (periodMode === 'DAY') {
          return txY === year && txM - 1 === month && txD === date;
        }
        return true;
      });
    }

    return list.sort((a, b) => {
      const dtA = `${a.date}T${a.time}`;
      const dtB = `${b.date}T${b.time}`;
      const timeA = new Date(dtA).getTime();
      const timeB = new Date(dtB).getTime();
      if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
        return timeB - timeA;
      }
      return dtB.localeCompare(dtA);
    });
  }, [allTransactions, periodMode, selectedDate, useSalaryCycle]);

  // Balance adjustment rows stay in the list but are not income or spending: totals, categories and
  // charts use the real rows only
  const countedTransactions = useMemo(
    () => withoutBalanceAdjustments(filteredTransactions),
    [filteredTransactions]
  );

  // Compute metrics for the filtered period
  const periodMetrics = useMemo(() => {
    const { totalIncome, totalExpense, transferTotal, categoryBreakdown, accountBreakdown } =
      summarizeTransactions(countedTransactions);

    const summary: DashboardSummary = {
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
      transferTotal,
      categoryBreakdown,
      accountBreakdown,
      recentTransactions: filteredTransactions.slice(0, 10),
    };

    return summary;
  }, [countedTransactions, filteredTransactions]);

  // Prepare chart time-series data based on active period
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (countedTransactions.length === 0) return [];

    if (periodMode === 'ALL' || periodMode === 'YEAR') {
      const monthMap = new Map<string, { income: number; expense: number }>();

      const sorted = [...countedTransactions].sort((a, b) => {
        const timeA = new Date(`${a.date}T${a.time}`).getTime();
        const timeB = new Date(`${b.date}T${b.time}`).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) return timeA - timeB;
        return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
      });

      for (const tx of sorted) {
        const [y, m] = tx.date.split('-');
        const monthLabel = `${THAI_MONTHS[parseInt(m, 10) - 1]} ${y.substring(2)}`;
        if (!monthMap.has(monthLabel)) {
          monthMap.set(monthLabel, { income: 0, expense: 0 });
        }
        const curr = monthMap.get(monthLabel)!;
        if (tx.type === 'INCOME') curr.income += tx.amount;
        else if (tx.type === 'EXPENSE') curr.expense += tx.amount;
      }

      return Array.from(monthMap.entries()).map(([label, val]) => ({
        label,
        income: val.income,
        expense: val.expense,
        net: val.income - val.expense,
      }));
    } else {
      const dayMap = new Map<string, { income: number; expense: number }>();
      const sorted = [...countedTransactions].sort((a, b) => {
        const timeA = new Date(`${a.date}T${a.time}`).getTime();
        const timeB = new Date(`${b.date}T${b.time}`).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) return timeA - timeB;
        return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
      });

      for (const tx of sorted) {
        const [, m, d] = tx.date.split('-');
        const dayLabel = `${parseInt(d, 10)} ${THAI_MONTHS[parseInt(m, 10) - 1]}`;
        if (!dayMap.has(dayLabel)) {
          dayMap.set(dayLabel, { income: 0, expense: 0 });
        }
        const curr = dayMap.get(dayLabel)!;
        if (tx.type === 'INCOME') curr.income += tx.amount;
        else if (tx.type === 'EXPENSE') curr.expense += tx.amount;
      }

      return Array.from(dayMap.entries()).map(([label, val]) => ({
        label,
        income: val.income,
        expense: val.expense,
        net: val.income - val.expense,
      }));
    }
  }, [countedTransactions, periodMode]);

  const prevCycleLabel = useMemo(() => {
    return getSalaryCycleRange(
      new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()),
      26
    ).label;
  }, [selectedDate]);

  return (
    <div className="min-h-screen flex flex-col bg-canvas transition-colors">
      <Navbar onSyncComplete={fetchData} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6 pb-28 md:pb-10">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">
              ภาพรวมการเงิน (Dashboard)
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted mt-1">
              เชื่อมต่อ Google Sheets สด พร้อมระบบ AI อ่านสลิปและ e-Statement อัตโนมัติ
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2.5">
            <ManualTransactionModal onSuccess={fetchData} />
          </div>
        </div>

        {error && (
          <Alert
            variant="warning"
            title="หมายเหตุ"
            action={
              <Button variant="secondary" size="sm" onClick={fetchData}>
                ลองใหม่
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {/* Period Selector */}
        <PeriodSelector
          mode={periodMode}
          onModeChange={setPeriodMode}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          useSalaryCycle={useSalaryCycle}
          onToggleSalaryCycle={setUseSalaryCycle}
        />

        {/* Helpful Banner when current filtered period has no transactions yet */}
        {!loading && allTransactions.length > 0 && filteredTransactions.length === 0 && (
          <Alert
            variant="info"
            action={
              <div className="flex items-center gap-2 flex-wrap">
                {periodMode === 'MONTH' && useSalaryCycle && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const prev = new Date(selectedDate);
                      prev.setMonth(prev.getMonth() - 1);
                      setSelectedDate(prev);
                    }}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>ดูรอบก่อนหน้า ({prevCycleLabel})</span>
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setPeriodMode('ALL')}>
                  ดูทั้งหมด (ALL)
                </Button>
              </div>
            }
          >
            {periodMode === 'MONTH' && useSalaryCycle ? (
              <>
                เพิ่งเริ่มต้นรอบเงินเดือนใหม่ (
                <strong className="text-ink font-semibold">
                  {getSalaryCycleRange(selectedDate, 26).label}
                </strong>
                ) และยังไม่มีรายการบันทึกในรอบนี้
              </>
            ) : (
              <>ยังไม่มีรายการบันทึกในช่วงเวลานี้</>
            )}
          </Alert>
        )}

        {/* Account Balances + 4 Summary Metric Cards */}
        <SummaryCards
          summary={periodMetrics}
          overallSummary={overallSummary}
          loading={loading}
          accountBalances={overallSummary?.accountBalances}
          totalCashInAccounts={overallSummary?.totalCashInAccounts}
          onBalanceAdjusted={fetchData}
        />

        {/* Visual Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 items-stretch">
          <div className="lg:col-span-2 h-full">
            <TrendChart data={chartData} loading={loading} />
          </div>
          <div className="h-full">
            <CategoryPieChart
              categoryBreakdown={periodMetrics.categoryBreakdown}
              totalExpense={periodMetrics.totalExpense}
              loading={loading}
            />
          </div>
        </div>

        {/* Lower Row: Account Breakdown & Period Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
          {/* Account Breakdown Card */}
          <Card className="flex flex-col justify-between overflow-hidden">
            <div className="p-5 sm:p-6">
              <h2 className="text-sm sm:text-base font-semibold text-ink tracking-tight">
                รายจ่ายแยกตามบัญชี
              </h2>
              <p className="text-xs text-ink-muted mt-0.5 mb-4">
                เปรียบเทียบยอดใช้จ่ายระหว่างบัญชี
              </p>

              {loading ? (
                <div className="space-y-2.5 py-2">
                  <div className="h-12 bg-surface-subtle animate-pulse rounded-control" />
                  <div className="h-12 bg-surface-subtle animate-pulse rounded-control" />
                </div>
              ) : Object.keys(periodMetrics.accountBreakdown || {}).length === 0 ? (
                <p className="text-xs text-ink-muted py-8 text-center">ไม่มีข้อมูลในรอบนี้</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(periodMetrics.accountBreakdown || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([acc, amt]) => {
                      const total = periodMetrics.totalExpense || 1;
                      const pct = Math.round((amt / total) * 100);
                      return (
                        <div
                          key={acc}
                          className="p-3 rounded-control bg-surface-subtle/50 border border-border space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-xs sm:text-sm text-ink truncate">
                              {acc}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold text-expense tabular-nums shrink-0">
                              ฿{formatMoney(amt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                              <div
                                className="h-full bg-accent rounded-full"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-ink-muted tabular-nums shrink-0">
                              {pct}% ของรายจ่ายทั้งหมด
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <CardFooter>
              <span className="text-xs text-ink-muted">
                ปรับตัวกรองช่วงเวลาด้านบนเพื่อดูยอดสะสมในแต่ละเดือน
              </span>
            </CardFooter>
          </Card>

          {/* Recent / Period Transactions Statement List */}
          <Card className="lg:col-span-2 flex flex-col justify-between overflow-hidden">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-ink tracking-tight">
                    รายการในช่วงเวลานี้
                  </h2>
                  <p className="text-xs text-ink-muted tabular-nums mt-0.5">
                    ทั้งหมด {filteredTransactions.length.toLocaleString('th-TH')} รายการ
                  </p>
                </div>
                <Link
                  href="/transactions"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline shrink-0"
                >
                  <span>ดูตารางทั้งหมด</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-2.5 py-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 bg-surface-subtle animate-pulse rounded-control" />
                  ))}
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12 text-ink-muted text-xs">
                  ไม่มีรายการธุรกรรมในช่วงเวลานี้
                </div>
              ) : (
                <div className="divide-y divide-border max-h-[390px] overflow-y-auto pr-1 custom-scrollbar">
                  {filteredTransactions.slice(0, 15).map((tx, idx) => {
                    const typeBadge =
                      tx.type === 'INCOME'
                        ? { variant: 'income' as const, label: 'รายรับ' }
                        : tx.type === 'TRANSFER'
                        ? { variant: 'transfer' as const, label: 'โอนย้าย' }
                        : { variant: 'expense' as const, label: 'รายจ่าย' };

                    const amountPrefix =
                      tx.type === 'INCOME' ? '+' : tx.type === 'EXPENSE' ? '-' : '';

                    const amountColor =
                      tx.type === 'INCOME'
                        ? 'text-income'
                        : tx.type === 'TRANSFER'
                        ? 'text-transfer'
                        : 'text-expense';

                    return (
                      <div
                        key={`${tx.id || 'recent'}-${idx}`}
                        className="py-3 flex items-start sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
                            {isBalanceAdjustment(tx) && (
                              <Badge
                                variant="accent"
                                title="รายการปรับให้ยอดตรงกับธนาคาร ไม่นับเป็นรายรับ/รายจ่าย"
                              >
                                ปรับยอด
                              </Badge>
                            )}
                            <span className="text-xs sm:text-sm font-medium text-ink truncate">
                              {tx.note || tx.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-muted tabular-nums truncate">
                            {tx.date}
                            {tx.time ? ` ${tx.time}` : ''} · {tx.account} · {tx.category}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className={`text-xs sm:text-sm font-semibold tabular-nums ${amountColor}`}>
                            {amountPrefix}฿{formatMoney(tx.amount)}
                          </p>
                          {tx.slipUrl && tx.slipUrl !== '-' && (
                            <a
                              href={tx.slipUrl.startsWith('http') ? tx.slipUrl : undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-end gap-1 text-[11px] text-accent-text hover:underline mt-0.5"
                            >
                              <span>สลิป</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <CardFooter>
              <span className="text-xs text-ink-muted tabular-nums">
                แสดง {Math.min(15, filteredTransactions.length)} รายการล่าสุดในรอบที่เลือก
              </span>
              <Link
                href="/transactions"
                className="inline-flex items-center justify-center min-h-9 px-3.5 py-1.5 text-xs font-medium rounded-control bg-surface border border-border-strong text-ink hover:bg-surface-subtle transition-colors"
              >
                ดูตารางและฟิลเตอร์ทั้งหมด
              </Link>
            </CardFooter>
          </Card>
        </div>
      </main>

      <MobileBottomNav onSyncComplete={fetchData} onRefresh={fetchData} />
    </div>
  );
}
