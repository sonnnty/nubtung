'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import {
  TaxSummaryCards,
  TaxIncomeForm,
  TaxDeductionsForm,
  TaxBracketTable,
  IncomeBreakdownModal,
} from '@/components/Tax';
import {
  calculateTax,
  defaultIncome,
  defaultDeductions,
} from '@/lib/tax/tax-engine';
import { categorizeTransactionsForTax } from '@/lib/tax/category-mapping';
import type {
  IncomeBySection,
  TaxDeductions,
  TaxCalculationResult,
  TaxBreakdownTransaction,
} from '@/lib/tax/tax-types';
import {
  Calculator,
  Calendar,
  RefreshCw,
  Save,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';
import { readJson } from '@/lib/utils/http';

interface NotificationState {
  type: 'success' | 'error' | 'info';
  message: string;
}

interface TaxApiResponse {
  success?: boolean;
  error?: string;
  syncedIncome?: IncomeBySection;
  savedProfile?: {
    income?: IncomeBySection;
    deductions?: TaxDeductions;
    withholdingTax?: number;
    excludedTransactionIds?: string[];
  };
  transactionsBySection?: Record<keyof IncomeBySection, TaxBreakdownTransaction[]>;
  exemptTransactions?: TaxBreakdownTransaction[];
  userExcludedIds?: string[];
  rawYearTransactions?: any[];
}

export default function TaxPage() {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(
    () => [
      currentYear - 2,
      currentYear - 1,
      currentYear,
      currentYear + 1,
      currentYear + 2,
    ],
    [currentYear]
  );

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [income, setIncome] = useState<IncomeBySection>(defaultIncome);
  const [syncedIncome, setSyncedIncome] = useState<IncomeBySection>(defaultIncome);
  const [deductions, setDeductions] = useState<TaxDeductions>(defaultDeductions);
  const [withholdingTax, setWithholdingTax] = useState<number>(0);
  const [isManualOverride, setIsManualOverride] = useState<boolean>(false);

  // Smart Tax Breakdown and Exclusions State
  const [transactionsBySection, setTransactionsBySection] = useState<
    Record<keyof IncomeBySection, TaxBreakdownTransaction[]>
  >({
    section40_1: [],
    section40_2: [],
    section40_3: [],
    section40_4: [],
    section40_5: [],
    section40_6: [],
    section40_7: [],
    section40_8: [],
  });
  const [exemptTransactions, setExemptTransactions] = useState<TaxBreakdownTransaction[]>([]);
  const [rawYearTransactions, setRawYearTransactions] = useState<any[]>([]);
  const [excludedTransactionIds, setExcludedTransactionIds] = useState<Set<string>>(new Set());

  // Breakdown Modal State
  const [breakdownModalOpen, setBreakdownModalOpen] = useState<boolean>(false);
  const [selectedBreakdownSection, setSelectedBreakdownSection] = useState<
    keyof IncomeBySection | 'exempt' | null
  >(null);
  const [selectedBreakdownTitle, setSelectedBreakdownTitle] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saved' | 'saving' | 'unsaved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isInitialLoadedRef = useRef<boolean>(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [notification, setNotification] = useState<NotificationState | null>(null);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showNotification = useCallback(
    (type: 'success' | 'error' | 'info', message: string) => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
      setNotification({ type, message });
      notificationTimerRef.current = setTimeout(() => {
        setNotification(null);
      }, 4000);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  // Fetch tax data for the selected year
  useEffect(() => {
    let ignore = false;

    async function loadData() {
      setError(null);
      try {
        const res = await fetch(`/api/tax?year=${selectedYear}`);
        let data: TaxApiResponse | null = null;

        try {
          data = await readJson(res);
        } catch {
          // Response was not JSON (e.g. HTML 500/502 page)
        }

        if (ignore) return;

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `ไม่สามารถดึงข้อมูลภาษีได้ (HTTP ${res.status})`);
        }

        const fetchedSynced: IncomeBySection = data.syncedIncome || defaultIncome;
        setSyncedIncome(fetchedSynced);

        if (data.transactionsBySection) {
          setTransactionsBySection(data.transactionsBySection);
        }
        if (data.exemptTransactions) {
          setExemptTransactions(data.exemptTransactions);
        }
        const excludedList: string[] =
          data.savedProfile?.excludedTransactionIds || data.userExcludedIds || [];
        setExcludedTransactionIds(new Set(excludedList));

        const rawTxs = data.rawYearTransactions || [
          ...(data.transactionsBySection ? Object.values(data.transactionsBySection).flat() : []),
          ...(data.exemptTransactions || []),
        ];
        setRawYearTransactions(rawTxs);

        if (data.savedProfile) {
          setIncome(data.savedProfile.income || fetchedSynced);
          setDeductions(data.savedProfile.deductions || defaultDeductions);
          setWithholdingTax(data.savedProfile.withholdingTax || 0);
          setIsManualOverride(false);
        } else {
          setIncome(fetchedSynced);
          setDeductions(defaultDeductions);
          setWithholdingTax(0);
          setIsManualOverride(false);
        }
        // Mark initial data load complete
        setTimeout(() => {
          if (!ignore) {
            isInitialLoadedRef.current = true;
            setAutoSaveStatus('saved');
          }
        }, 300);
      } catch (err: unknown) {
        if (ignore) return;
        const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูลภาษี';
        setError(msg);
        showNotification('error', msg);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    isInitialLoadedRef.current = false;
    setAutoSaveStatus('idle');
    loadData();

    return () => {
      ignore = true;
    };
  }, [selectedYear, showNotification]);

  // Debounced Auto-Save to Google Sheets
  useEffect(() => {
    if (!isInitialLoadedRef.current || loading) return;

    setAutoSaveStatus('unsaved');
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving');
      try {
        const res = await fetch('/api/tax', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: selectedYear,
            income,
            deductions,
            withholdingTax,
            excludedTransactionIds: Array.from(excludedTransactionIds),
          }),
        });

        let data: { success?: boolean; error?: string } | null = null;
        try {
          data = await readJson(res);
        } catch {
          // Ignore
        }

        if (res.ok && data?.success) {
          setAutoSaveStatus('saved');
        } else {
          setAutoSaveStatus('error');
        }
      } catch {
        setAutoSaveStatus('error');
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [income, deductions, withholdingTax, selectedYear, loading, excludedTransactionIds]);

  // Explicit sync triggered by user
  const handleExplicitSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const res = await fetch(`/api/tax?year=${selectedYear}`);
      let data: TaxApiResponse | null = null;

      try {
        data = await readJson(res);
      } catch {
        // Non-JSON response
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `ไม่สามารถซิงค์ข้อมูลภาษีได้ (HTTP ${res.status})`);
      }

      const fetchedSynced: IncomeBySection = data.syncedIncome || defaultIncome;
      setSyncedIncome(fetchedSynced);
      setIncome(fetchedSynced);
      setIsManualOverride(false);

      if (data.transactionsBySection) {
        setTransactionsBySection(data.transactionsBySection);
      }
      if (data.exemptTransactions) {
        setExemptTransactions(data.exemptTransactions);
      }
      const excludedList: string[] =
        data.savedProfile?.excludedTransactionIds || data.userExcludedIds || [];
      setExcludedTransactionIds(new Set(excludedList));

      const rawTxs = data.rawYearTransactions || [
        ...(data.transactionsBySection ? Object.values(data.transactionsBySection).flat() : []),
        ...(data.exemptTransactions || []),
      ];
      setRawYearTransactions(rawTxs);

      showNotification(
        'success',
        `ซิงค์รายได้ปี ${selectedYear} (พ.ศ. ${selectedYear + 543}) จากรายการธุรกรรมเรียบร้อยแล้ว`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการซิงค์ข้อมูลรายได้';
      setError(msg);
      showNotification('error', msg);
    } finally {
      setSyncing(false);
    }
  };

  // Real-time tax calculation
  const result: TaxCalculationResult = useMemo(() => {
    return calculateTax(income, deductions, withholdingTax);
  }, [income, deductions, withholdingTax]);

  // Save tax profile to Google Sheets
  const handleSaveToSheet = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          income,
          deductions,
          withholdingTax,
          excludedTransactionIds: Array.from(excludedTransactionIds),
        }),
      });

      let data: { success?: boolean; error?: string } | null = null;
      try {
        data = await readJson(res);
      } catch {
        // Non-JSON response
      }

      if (!res.ok || !data?.success) {
        throw new Error(
          data?.error || `ไม่สามารถบันทึกข้อมูลภาษีลง Google Sheet ได้ (HTTP ${res.status})`
        );
      }

      showNotification(
        'success',
        `บันทึกข้อมูลภาษีปี ${selectedYear} ลง Google Sheet สำเร็จแล้ว`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลง Google Sheet';
      showNotification('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleIncomeChange = (key: keyof IncomeBySection, value: number) => {
    setIncome((prev) => ({ ...prev, [key]: value }));
    setIsManualOverride(true);
  };

  const handleDeductionChange = (key: keyof TaxDeductions, value: number) => {
    setDeductions((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetSynced = () => {
    setIncome(syncedIncome);
    setIsManualOverride(false);
    showNotification('info', 'รีเซ็ตข้อมูลรายได้กลับเป็นค่าที่คำนวณจากรายการธุรกรรมแล้ว');
  };

  const handleToggleOverride = () => {
    setIsManualOverride((prev) => !prev);
  };

  const handleYearChange = (year: number) => {
    if (saving || year === selectedYear) return;
    setLoading(true);
    setSelectedYear(year);
  };

  const handleToggleExclude = useCallback(
    (txId: string) => {
      const nextExcluded = new Set(excludedTransactionIds);
      if (nextExcluded.has(txId)) {
        nextExcluded.delete(txId);
      } else {
        nextExcluded.add(txId);
      }
      setExcludedTransactionIds(nextExcluded);

      const txsToCategorize =
        rawYearTransactions.length > 0
          ? rawYearTransactions
          : [
              ...Object.values(transactionsBySection).flat(),
              ...exemptTransactions,
            ];

      // Recompute with categorizeTransactionsForTax so income and exemptions reflect instantly
      const categorized = categorizeTransactionsForTax(txsToCategorize, nextExcluded);
      setSyncedIncome(categorized.syncedIncome);
      setTransactionsBySection(categorized.transactionsBySection);
      setExemptTransactions(categorized.exemptTransactions);

      if (!isManualOverride) {
        setIncome(categorized.syncedIncome);
      }
    },
    [
      excludedTransactionIds,
      rawYearTransactions,
      transactionsBySection,
      exemptTransactions,
      isManualOverride,
    ]
  );

  const handleOpenBreakdown = useCallback(
    (sectionKey: keyof IncomeBySection | 'exempt', title: string) => {
      setSelectedBreakdownSection(sectionKey);
      setSelectedBreakdownTitle(title);
      setBreakdownModalOpen(true);
    },
    []
  );

  const modalTransactions: TaxBreakdownTransaction[] = useMemo(() => {
    if (!selectedBreakdownSection) return [];
    if (selectedBreakdownSection === 'exempt') {
      return exemptTransactions;
    }
    const active = transactionsBySection[selectedBreakdownSection] || [];
    const excludedForSection = exemptTransactions.filter(
      (tx) => tx.section === selectedBreakdownSection
    );
    const combined = [...active, ...excludedForSection];
    const seen = new Set<string>();
    return combined
      .filter((tx) => {
        const key = tx.id || `${tx.date}-${tx.amount}-${tx.note}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [selectedBreakdownSection, transactionsBySection, exemptTransactions]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0b0f19] transition-colors">
      <Navbar onSyncComplete={handleExplicitSync} />

      {/* Floating Notification Toast */}
      {notification && (
        <div
          role="alert"
          className={`fixed top-18 right-4 z-50 max-w-md w-[calc(100%-2rem)] sm:w-auto p-4 rounded-2xl shadow-xl border flex items-center justify-between gap-3 backdrop-blur-md transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50/95 dark:bg-emerald-950/95 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
              : notification.type === 'error'
              ? 'bg-rose-50/95 dark:bg-rose-950/95 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100'
              : 'bg-sky-50/95 dark:bg-sky-950/95 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-100'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {notification.type === 'success' && (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            {notification.type === 'error' && (
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            {notification.type === 'info' && (
              <Info className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
            )}
            <p className="text-xs sm:text-sm font-medium leading-snug">{notification.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0 cursor-pointer"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6 pb-28 md:pb-8">
        {/* Page Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                <Calculator className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                คำนวณและวางแผนภาษี (Personal Income Tax)
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              คำนวณภาษีเงินได้บุคคลธรรมดา (ภ.ง.ด. 90/91) เชื่อมโยงบัญชีรายรับรายจ่าย พร้อมแนะนำสิทธิลดหย่อนเต็มพิกัด
            </p>
          </div>

          {/* Action controls */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Year Selector */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 overflow-x-auto">
              <Calendar className="w-4 h-4 text-slate-400 ml-2 mr-1 shrink-0" />
              {availableYears.map((yr) => {
                const isSelected = yr === selectedYear;
                return (
                  <button
                    key={yr}
                    type="button"
                    disabled={saving}
                    onClick={() => handleYearChange(yr)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    ปี {yr} (พ.ศ. {yr + 543})
                  </button>
                );
              })}
            </div>

            {/* Sync from Transactions Button */}
            <button
              type="button"
              onClick={handleExplicitSync}
              disabled={syncing || loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              title="ดึงข้อมูลรายได้จากแท็บธุรกรรมมาคำนวณใหม่"
            >
              <RefreshCw
                className={`w-4 h-4 ${syncing ? 'animate-spin text-emerald-500' : 'text-slate-500'}`}
              />
              <span>{syncing ? 'กำลังซิงค์...' : 'ซิงค์รายได้จากบัญชี'}</span>
            </button>

            {/* Manual Override Toggle */}
            <button
              type="button"
              onClick={handleToggleOverride}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-xs ${
                isManualOverride
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title="เปิด/ปิดการแก้ไขตัวเลขเงินได้ด้วยตนเอง"
            >
              <Sliders className="w-4 h-4" />
              <span>{isManualOverride ? 'โหมดแก้ไขอิสระ' : 'แก้ไขตัวเลขอิสระ'}</span>
            </button>

            {/* Auto-Save Status Badge */}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium border border-slate-200/80 dark:border-slate-700/80 shadow-xs">
              {autoSaveStatus === 'saving' && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                  <span className="text-blue-600 dark:text-blue-400">กำลังบันทึกอัตโนมัติ...</span>
                </>
              )}
              {autoSaveStatus === 'saved' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Auto-Save บันทึกแล้ว</span>
                </>
              )}
              {autoSaveStatus === 'unsaved' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
                  <span className="text-amber-600 dark:text-amber-400">กำลังพิมพ์ (รอ Auto-Save)</span>
                </>
              )}
              {autoSaveStatus === 'error' && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400">บันทึกไม่สำเร็จ</span>
                </>
              )}
              {autoSaveStatus === 'idle' && (
                <>
                  <Save className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500 dark:text-slate-400">Auto-Save เปิดใช้งาน</span>
                </>
              )}
            </div>

            {/* Save to Google Sheet Button */}
            <button
              type="button"
              onClick={handleSaveToSheet}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              title="บันทึกข้อมูลภาษีและสิทธิลดหย่อนลง Google Sheets ทันที"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'กำลังบันทึก...' : 'บันทึกทันที'}</span>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                handleExplicitSync();
              }}
              className="px-3 py-1 bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 text-amber-900 dark:text-amber-100 rounded-xl font-medium transition-colors cursor-pointer"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {/* 1. Summary Cards */}
        <TaxSummaryCards result={result} loading={loading} />

        {/* 2. Income Form (Section 40) */}
        <TaxIncomeForm
          income={income}
          expenses={result.expensesBySection}
          onChange={handleIncomeChange}
          isManualOverride={isManualOverride}
          onToggleOverride={handleToggleOverride}
          onResetSynced={handleResetSynced}
          transactionsBySection={transactionsBySection}
          exemptTransactions={exemptTransactions}
          excludedTransactionIds={excludedTransactionIds}
          onOpenBreakdown={handleOpenBreakdown}
        />

        {/* 3. Deductions Form */}
        <TaxDeductionsForm
          deductions={deductions}
          onChange={handleDeductionChange}
          result={result}
          withholdingTax={withholdingTax}
          onWithholdingChange={setWithholdingTax}
          year={selectedYear}
        />

        {/* 4. Progressive Tax Bracket Table */}
        <TaxBracketTable result={result} />
      </main>

      {/* Income Breakdown Modal */}
      <IncomeBreakdownModal
        isOpen={breakdownModalOpen}
        onClose={() => setBreakdownModalOpen(false)}
        sectionKey={selectedBreakdownSection}
        sectionTitle={selectedBreakdownTitle}
        transactions={modalTransactions}
        excludedIds={excludedTransactionIds}
        onToggleExclude={handleToggleExclude}
      />

      <MobileBottomNav
        onSyncComplete={handleExplicitSync}
        onRefresh={handleExplicitSync}
      />
    </div>
  );
}
