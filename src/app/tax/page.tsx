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
import { Alert, Badge, Button } from '@/components/ui';
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
  rawYearTransactions?: TaxBreakdownTransaction[];
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
  const [rawYearTransactions, setRawYearTransactions] = useState<TaxBreakdownTransaction[]>([]);
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
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    'idle' | 'saved' | 'saving' | 'unsaved' | 'error'
  >('idle');
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset auto-save badge before loading selected year
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

      showNotification('success', `บันทึกข้อมูลภาษีปี ${selectedYear} ลง Google Sheet สำเร็จแล้ว`);
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

  const handleWithholdingChange = (value: number) => {
    setWithholdingTax(value);
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
          : [...Object.values(transactionsBySection).flat(), ...exemptTransactions];

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
    <div className="min-h-screen flex flex-col bg-canvas transition-colors">
      <Navbar onSyncComplete={handleExplicitSync} />

      {/* Floating Notification Toast */}
      {notification && (
        <div
          role={notification.type === 'error' ? 'alert' : 'status'}
          className={`fixed top-18 right-4 z-50 max-w-md w-[calc(100%-2rem)] sm:w-auto p-3.5 rounded-card shadow-popover border flex items-center justify-between gap-3 bg-surface ${
            notification.type === 'success'
              ? 'border-income-border'
              : notification.type === 'error'
              ? 'border-expense-border'
              : 'border-transfer-border'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {notification.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-income shrink-0" />
            )}
            {notification.type === 'error' && (
              <AlertTriangle className="w-4 h-4 text-expense shrink-0" />
            )}
            {notification.type === 'info' && (
              <Info className="w-4 h-4 text-transfer shrink-0" />
            )}
            <p className="text-xs sm:text-sm font-medium text-ink leading-snug">
              {notification.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-control text-ink-muted hover:text-ink hover:bg-surface-subtle transition-colors shrink-0 cursor-pointer"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 pb-28 md:pb-10">
        {/* Page Header */}
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">
                คำนวณและวางแผนภาษีเงินได้บุคคลธรรมดา
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted mt-1">
                แบบแสดงรายการ ภ.ง.ด. 90/91 เชื่อมโยงรายรับจากบัญชีและคำนวณสิทธิลดหย่อนตามกฎหมาย
              </p>
            </div>

            {/* Auto-Save & Save Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={
                  autoSaveStatus === 'saved'
                    ? 'income'
                    : autoSaveStatus === 'error'
                    ? 'expense'
                    : autoSaveStatus === 'unsaved'
                    ? 'warning'
                    : autoSaveStatus === 'saving'
                    ? 'transfer'
                    : 'neutral'
                }
                className="py-1.5 px-2.5 text-xs"
              >
                {autoSaveStatus === 'saving' && (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>กำลังบันทึกอัตโนมัติ...</span>
                  </>
                )}
                {autoSaveStatus === 'saved' && (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>บันทึกอัตโนมัติแล้ว</span>
                  </>
                )}
                {autoSaveStatus === 'unsaved' && <span>รอการบันทึกอัตโนมัติ</span>}
                {autoSaveStatus === 'error' && (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>บันทึกไม่สำเร็จ</span>
                  </>
                )}
                {autoSaveStatus === 'idle' && (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>เปิดใช้งานบันทึกอัตโนมัติ</span>
                  </>
                )}
              </Badge>

              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveToSheet}
                disabled={saving || loading}
                title="บันทึกข้อมูลภาษีและสิทธิลดหย่อนลง Google Sheets ทันที"
              >
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{saving ? 'กำลังบันทึก...' : 'บันทึกทันที'}</span>
              </Button>
            </div>
          </div>

          {/* Year & Sync Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 p-3 bg-surface border border-border rounded-card shadow-card">
            <div className="flex items-center gap-1 p-1 bg-surface-subtle rounded-control border border-border overflow-x-auto no-scrollbar">
              <Calendar className="w-4 h-4 text-ink-muted ml-2 mr-1 shrink-0 hidden sm:block" />
              {availableYears.map((yr) => {
                const isSelected = yr === selectedYear;
                return (
                  <button
                    key={yr}
                    type="button"
                    disabled={saving}
                    onClick={() => handleYearChange(yr)}
                    aria-pressed={isSelected}
                    title={`ปีภาษี ${yr} (พ.ศ. ${yr + 543})`}
                    className={`min-h-9 sm:min-h-8 px-2.5 sm:px-3 py-1 rounded-badge text-xs font-medium transition-colors shrink-0 flex-1 sm:flex-none text-center cursor-pointer tabular-nums disabled:opacity-50 ${
                      isSelected
                        ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                        : 'text-ink-secondary hover:text-ink border border-transparent'
                    }`}
                  >
                    <span className="sm:hidden">{yr + 543}</span>
                    <span className="hidden sm:inline">ปี {yr} (พ.ศ. {yr + 543})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExplicitSync}
                disabled={syncing || loading}
                title="ดึงข้อมูลรายได้จากแท็บธุรกรรมมาคำนวณใหม่"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'กำลังซิงค์...' : 'ซิงค์รายได้จากบัญชี'}</span>
              </Button>

              <Button
                variant={isManualOverride ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleToggleOverride}
                aria-pressed={isManualOverride}
                title="เปิด/ปิดการแก้ไขตัวเลขเงินได้ด้วยตนเอง"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{isManualOverride ? 'โหมดแก้ไขอิสระ (เปิด)' : 'แก้ไขตัวเลขอิสระ'}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <Alert
            variant="warning"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  handleExplicitSync();
                }}
              >
                ลองใหม่
              </Button>
            }
          >
            {error}
          </Alert>
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
          onWithholdingChange={handleWithholdingChange}
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

      <MobileBottomNav onSyncComplete={handleExplicitSync} onRefresh={handleExplicitSync} />
    </div>
  );
}
