'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import SummaryCards from '@/components/Dashboard/SummaryCards';
import PeriodSelector, { PeriodMode, getSalaryCycleRange } from '@/components/Dashboard/PeriodSelector';
import TrendChart, { ChartDataPoint } from '@/components/Dashboard/TrendChart';
import CategoryPieChart from '@/components/Dashboard/CategoryPieChart';
import ManualTransactionModal from '@/components/Transactions/ManualTransactionModal';
import { Transaction, DashboardSummary } from '@/types';
import Link from 'next/link';
import {
  ArrowRight,
  ExternalLink,
  Building2,
  ListOrdered,
  Info,
} from 'lucide-react';
import { readJson } from '@/lib/utils/http';

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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  // Compute metrics for the filtered period
  const periodMetrics = useMemo(() => {
    let income = 0;
    let expense = 0;
    let transfer = 0;
    const categoryMap: Record<string, number> = {};
    const accountMap: Record<string, number> = {};

    for (const tx of filteredTransactions) {
      const amount = tx.amount || 0;
      if (tx.type === 'INCOME') {
        income += amount;
      } else if (tx.type === 'EXPENSE') {
        expense += amount;
        categoryMap[tx.category] = (categoryMap[tx.category] || 0) + amount;
        accountMap[tx.account] = (accountMap[tx.account] || 0) + amount;
      } else if (tx.type === 'TRANSFER') {
        transfer += amount;
      }
    }

    const summary: DashboardSummary = {
      totalIncome: income,
      totalExpense: expense,
      netBalance: income - expense,
      transferTotal: transfer,
      categoryBreakdown: categoryMap,
      accountBreakdown: accountMap,
      recentTransactions: filteredTransactions.slice(0, 10),
    };

    return summary;
  }, [filteredTransactions]);

  // Prepare chart time-series data based on active period
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (filteredTransactions.length === 0) return [];

    if (periodMode === 'ALL' || periodMode === 'YEAR') {
      // Group by Month (e.g. ต.ค. 25, พ.ย. 25, ม.ค. 26...)
      const monthMap = new Map<string, { income: number; expense: number }>();

      // Sort chronological
      const sorted = [...filteredTransactions].sort((a, b) => {
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
      // Group by Day (e.g. 1 ก.ย., 2 ก.ย., ...)
      const dayMap = new Map<string, { income: number; expense: number }>();
      const sorted = [...filteredTransactions].sort((a, b) => {
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
  }, [filteredTransactions, periodMode]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0b0f19] transition-colors">
      <Navbar onSyncComplete={fetchData} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-8 pb-28 md:pb-8">
        {/* Header & Action bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              ภาพรวมการเงิน (Dashboard)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              เชื่อมต่อ Google Sheets สด พร้อมระบบ AI อ่านสลิปและ e-Statement อัตโนมัติ
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            <ManualTransactionModal onSuccess={fetchData} />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between">
            <div>
              <span className="font-bold">หมายเหตุ: </span>
              <span>{error}</span>
            </div>
            <button
              onClick={fetchData}
              className="px-3 py-1 bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 text-amber-900 dark:text-amber-100 rounded-xl font-medium transition-colors"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {/* Period Selector Component (ALL, YEAR, MONTH, WEEK, DAY + Prev/Next + Salary Cycle) */}
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
          <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in">
            <div className="flex items-start sm:items-center gap-2.5 text-amber-900 dark:text-amber-200">
              <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5 sm:mt-0" />
              <span>
                {periodMode === 'MONTH' && useSalaryCycle ? (
                  <>
                    เพิ่งเริ่มต้นรอบเงินเดือนใหม่ (<strong>{getSalaryCycleRange(selectedDate, 26).label}</strong>) และยังไม่มีรายการบันทึกในรอบนี้
                  </>
                ) : (
                  <>ยังไม่มีรายการบันทึกในช่วงเวลานี้</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {periodMode === 'MONTH' && useSalaryCycle && (
                <button
                  type="button"
                  onClick={() => {
                    const prev = new Date(selectedDate);
                    prev.setMonth(prev.getMonth() - 1);
                    setSelectedDate(prev);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-200 dark:bg-amber-800/80 hover:bg-amber-300 dark:hover:bg-amber-700 text-amber-950 dark:text-amber-100 font-bold transition-all text-xs active:scale-95 cursor-pointer shadow-xs"
                >
                  👈 ดูรอบก่อนหน้า ({getSalaryCycleRange(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()), 26).label})
                </button>
              )}
              <button
                type="button"
                onClick={() => setPeriodMode('ALL')}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium transition-all text-xs cursor-pointer shadow-xs"
              >
                ดูทั้งหมด (ALL)
              </button>
            </div>
          </div>
        )}

        {/* 4 Summary Cards + Real Account Balances Header */}
        <SummaryCards
          summary={periodMetrics}
          overallSummary={overallSummary}
          loading={loading}
          accountBalances={overallSummary?.accountBalances}
          totalCashInAccounts={overallSummary?.totalCashInAccounts}
        />

        {/* Visual Charts Grid: Trend Chart & Category Donut Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Trend Chart (2 columns wide) */}
          <div className="lg:col-span-2 h-full">
            <TrendChart data={chartData} loading={loading} />
          </div>

          {/* Category Pie Chart (1 column wide) */}
          <div className="h-full">
            <CategoryPieChart
              categoryBreakdown={periodMetrics.categoryBreakdown}
              totalExpense={periodMetrics.totalExpense}
              loading={loading}
            />
          </div>
        </div>

        {/* Lower Row: Account Breakdown & Filtered Transactions List */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Account Breakdown Card */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-sky-500" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  รายจ่ายแยกตามบัญชี
                </h2>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-4">
                เปรียบเทียบยอดใช้จ่ายระหว่างบัญชี
              </p>

              {loading ? (
                <div className="space-y-2 py-2">
                  <div className="h-10 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-2xl" />
                  <div className="h-10 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-2xl" />
                </div>
              ) : Object.keys(periodMetrics.accountBreakdown || {}).length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 py-6 text-center">ไม่มีข้อมูลในรอบนี้</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(periodMetrics.accountBreakdown || {}).map(([acc, amt]) => {
                    const total = periodMetrics.totalExpense || 1;
                    const pct = Math.round((amt / total) * 100);
                    return (
                      <div
                        key={acc}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 block">
                            {acc}
                          </span>
                          <span className="text-[11px] text-slate-400">{pct}% ของรายจ่ายทั้งหมด</span>
                        </div>
                        <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                          ฿{amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block">
                💡 ปรับตัวกรองช่วงเวลาด้านบนเพื่อดูยอดสะสมในแต่ละเดือน
              </span>
            </div>
          </div>

          {/* Recent / Period Transactions List */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ListOrdered className="w-4 h-4 text-emerald-500" />
                    <span>รายการในช่วงเวลานี้ ({filteredTransactions.length} รายการ)</span>
                  </h2>
                </div>
                <Link
                  href="/transactions"
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                >
                  <span>ดูตารางทั้งหมด</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/40 animate-pulse rounded-2xl" />
                  ))}
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  ไม่มีรายการธุรกรรมในช่วงเวลานี้
                </div>
              ) : (
                <div className="divide-y divide-slate-200/60 dark:divide-slate-800/60 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                  {filteredTransactions.slice(0, 15).map((tx, idx) => (
                    <div key={`${tx.id || 'recent'}-${idx}`} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-2xl flex items-center justify-center text-xs font-bold shrink-0 ${
                            tx.type === 'INCOME'
                              ? 'bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : tx.type === 'TRANSFER'
                              ? 'bg-amber-100/70 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                              : 'bg-rose-100/70 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {tx.type === 'INCOME' ? 'เข้า' : tx.type === 'TRANSFER' ? 'โอน' : 'ออก'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tx.note || tx.category}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            {tx.date} {tx.time ? `• ${tx.time}` : ''} • {tx.account} • {tx.category}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-xs font-bold ${
                            tx.type === 'INCOME'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.type === 'TRANSFER'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {tx.type === 'INCOME' ? '+' : tx.type === 'TRANSFER' ? '🔄 ' : '-'}฿
                          {tx.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </p>
                        {tx.slipUrl && tx.slipUrl !== '-' && (
                          <a
                            href={tx.slipUrl.startsWith('http') ? tx.slipUrl : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center justify-end gap-0.5 mt-0.5"
                          >
                            <span>สลิป</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-400 dark:text-slate-500">
                ข้อมูลสดจาก Google Sheets
              </span>
              <Link
                href="/transactions"
                className="text-xs font-semibold px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
              >
                ดูตารางและฟิลเตอร์ทั้งหมด
              </Link>
            </div>
          </div>
        </div>
      </main>

      <MobileBottomNav onSyncComplete={fetchData} onRefresh={fetchData} />
    </div>
  );
}
