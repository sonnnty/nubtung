'use client';

import React, { useState } from 'react';
import {
  Users,
  ShieldCheck,
  PiggyBank,
  Home,
  Check,
  AlertTriangle,
  Info,
  TrendingUp,
  Plus,
  Minus,
  Sparkles,
  RefreshCw,
  X,
  FileText,
} from 'lucide-react';
import type { TaxDeductions, TaxCalculationResult } from '@/lib/tax/tax-types';
import type { GhbReceipt } from '@/lib/ghb/sync';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';

interface TaxDeductionsFormProps {
  deductions: TaxDeductions;
  onChange: (key: keyof TaxDeductions, value: number) => void;
  result: TaxCalculationResult;
  withholdingTax?: number;
  onWithholdingChange?: (val: number) => void;
  year?: number;
}

type TabKey = 'family' | 'insurance' | 'retirement' | 'property';

export default function TaxDeductionsForm({
  deductions,
  onChange,
  result,
  withholdingTax = 0,
  onWithholdingChange,
  year = new Date().getFullYear(),
}: TaxDeductionsFormProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('family');
  const [monthlySsoRate, setMonthlySsoRate] = useState<number>(750);

  // GH Bank Sync State
  const [ghbLoading, setGhbLoading] = useState<boolean>(false);
  const [ghbMessage, setGhbMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ghbReceipts, setGhbReceipts] = useState<GhbReceipt[]>([]);
  const [showGhbModal, setShowGhbModal] = useState<boolean>(false);
  const { closeModal: closeGhbModal } = useHistoryModal({
    isOpen: showGhbModal,
    onClose: () => setShowGhbModal(false),
    modalId: 'ghb-receipts-modal',
  });

  const handleGhbSync = async () => {
    setGhbLoading(true);
    setGhbMessage(null);
    try {
      const res = await fetch(`/api/tax/ghb?year=${year}`);
      const data = await readJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถดึงข้อมูลได้');
      }

      setGhbReceipts(data.receipts || []);
      const totalInterest = Number(data.totalInterest) || 0;
      onChange('homeLoanInterest', totalInterest);
      setGhbMessage({
        type: 'success',
        text: `ดึงสำเร็จ ${data.receiptCount} ใบเสร็จ ยอดดอกเบี้ยรวม ฿${totalInterest.toLocaleString('th-TH')}`,
      });
    } catch (err: unknown) {
      setGhbMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลจากอีเมล',
      });
    } finally {
      setGhbLoading(false);
    }
  };

  const handleNumberInput = (key: keyof TaxDeductions, rawValue: string) => {
    const cleaned = rawValue.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    onChange(key, isNaN(num) ? 0 : Math.max(0, num));
  };

  const handleStepper = (key: keyof TaxDeductions, delta: number, min = 0, max = 99) => {
    const current = deductions[key] || 0;
    const updated = Math.min(max, Math.max(min, current + delta));
    onChange(key, updated);
  };

  // Retirement Group Calculation for progress bar
  const rmfVal = deductions.rmf || 0;
  const ssfVal = deductions.ssf || 0;
  const pvdVal = deductions.pvd || 0;
  const pensionVal = deductions.pensionInsurance || 0;
  const thaiEsgVal = deductions.thaiEsg || 0;

  const retirementSum = rmfVal + ssfVal + pvdVal + pensionVal;
  const retirementCeiling = 500000;
  const retirementPercent = Math.min(100, Math.round((retirementSum / retirementCeiling) * 100));
  const retirementRemaining = Math.max(0, retirementCeiling - retirementSum);

  const thaiEsgCeiling = 300000;
  const thaiEsgPercent = Math.min(100, Math.round((thaiEsgVal / thaiEsgCeiling) * 100));
  const thaiEsgRemaining = Math.max(0, thaiEsgCeiling - thaiEsgVal);

  const tabs: {
    id: TabKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    subtotal: number;
    badgeColor: string;
  }[] = [
    {
      id: 'family',
      label: 'ตนเองและครอบครัว',
      icon: Users,
      subtotal: result.deductionsBreakdown.personalFamily,
      badgeColor: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
    },
    {
      id: 'insurance',
      label: 'ประกันและการออม',
      icon: ShieldCheck,
      subtotal: result.deductionsBreakdown.insuranceSavings,
      badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      id: 'retirement',
      label: 'กองทุนเกษียณ & ThaiESG',
      icon: PiggyBank,
      subtotal: result.deductionsBreakdown.retirementGroup + result.deductionsBreakdown.thaiEsg,
      badgeColor: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40',
    },
    {
      id: 'property',
      label: 'อสังหาฯ บริจาค & ภาษีหัก',
      icon: Home,
      subtotal: result.deductionsBreakdown.propertyEconomy + result.deductionsBreakdown.donations,
      badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
    },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-4 sm:p-6 space-y-6">
      {/* Form Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              รายการลดหย่อนภาษี (Tax Deductions)
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            ระบุสิทธิประโยชน์ทางภาษี ค่าลดหย่อนครอบครัว ประกัน กองทุน และเงินบริจาคตามสิทธิที่กฎหมายกำหนด
          </p>
        </div>

        <div className="px-3.5 py-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ลดหย่อนรวม:</span>
          <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
            ฿{result.totalDeductions.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                isActive
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm'
                  : 'bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                    isActive
                      ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
                      : tab.badgeColor
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-bold leading-tight line-clamp-1">{tab.label}</span>
              </div>

              <div className="flex items-baseline justify-between pt-1 border-t border-current/10">
                <span className="text-[10px] opacity-75">ลดหย่อนได้</span>
                <span className="text-xs font-extrabold">
                  ฿{tab.subtotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ตนเองและครอบครัว */}
      {activeTab === 'family' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ตนเอง (Fixed 60,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    ลดหย่อนส่วนตัว (ตนเอง)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ผู้มีเงินได้ทุกคนได้รับสิทธิลดหย่อนอัตโนมัติตามกฎหมาย
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  สิทธิคงที่
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  disabled
                  value="฿60,000.00"
                  className="w-full px-3 py-2 text-sm font-semibold text-slate-500 dark:text-slate-400 bg-slate-200/50 dark:bg-slate-800/80 rounded-xl border border-slate-300/60 dark:border-slate-700 cursor-not-allowed"
                />
              </div>
            </div>

            {/* คู่สมรสไม่มีเงินได้ (Toggle / 60,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    คู่สมรสที่ไม่มีเงินได้
                  </h4>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    ลดหย่อน 60,000 บาท
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  จดทะเบียนสมรสถูกต้องตามกฎหมาย และคู่สมรสไม่มีเงินได้พึงประเมิน
                </p>
              </div>

              <label className="flex items-center gap-3 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={Boolean(deductions.spouse)}
                  onChange={(e) => onChange('spouse', e.target.checked ? 60000 : 0)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-700"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {deductions.spouse ? 'มีคู่สมรสไม่มีเงินได้ (ใช้สิทธิลดหย่อน ฿60,000)' : 'ไม่มี / ไม่ได้ใช้สิทธินี้'}
                </span>
              </label>
            </div>

            {/* บุตรชอบด้วยกฎหมาย (คนละ 30,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    จำนวนบุตร (ทั่วไป / เกิดก่อนปี 61)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ลดหย่อนคนละ 30,000 บาท (อายุไม่เกิน 20 ปี หรือศึกษาอยู่ไม่เกิน 25 ปี)
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepper('childCount', -1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Minus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center text-sm font-bold text-slate-800 dark:text-white">
                    {deductions.childCount || 0} คน
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStepper('childCount', 1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  ฿{((deductions.childCount || 0) * 30000).toLocaleString('th-TH')}
                </span>
              </div>
            </div>

            {/* บุตรคนที่ 2 ขึ้นไปเกิดปี 61 เป็นต้นไป (คนละ 60,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    บุตรคนที่ 2 ขึ้นไปเกิดปี 2561+
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ลดหย่อนคนละ 60,000 บาท ตามมาตรการสนับสนุนการมีบุตร
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepper('child2018Count', -1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Minus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center text-sm font-bold text-slate-800 dark:text-white">
                    {deductions.child2018Count || 0} คน
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStepper('child2018Count', 1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  ฿{((deductions.child2018Count || 0) * 60000).toLocaleString('th-TH')}
                </span>
              </div>
            </div>

            {/* บิดามารดา (คนละ 30,000 สูงสุด 4 คน) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    อุปการะบิดามารดา (อายุ 60 ปีขึ้นไป)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    คนละ 30,000 บาท สูงสุด 4 คน (ตนเอง 2 + คู่สมรส 2) มีรายได้ไม่เกิน 30,000 บ./ปี
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepper('parentCount', -1, 0, 4)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Minus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center text-sm font-bold text-slate-800 dark:text-white">
                    {deductions.parentCount || 0} คน
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStepper('parentCount', 1, 0, 4)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  ฿{((deductions.parentCount || 0) * 30000).toLocaleString('th-TH')}
                </span>
              </div>
            </div>

            {/* ผู้พิการ / ทุพพลภาพ (คนละ 60,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    อุปการะผู้พิการหรือทุพพลภาพ
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ลดหย่อนคนละ 60,000 บาท (มีบัตรประจำตัวคนพิการ)
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepper('disabledCount', -1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Minus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center text-sm font-bold text-slate-800 dark:text-white">
                    {deductions.disabledCount || 0} คน
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStepper('disabledCount', 1)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  ฿{((deductions.disabledCount || 0) * 60000).toLocaleString('th-TH')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ประกันและการออม */}
      {activeTab === 'insurance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ประกันสังคม (Max 9,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เงินสมทบกองทุนประกันสังคม
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ตามจ่ายจริง สูงสุดไม่เกิน 9,000 บาท/ปี
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  สูงสุด ฿9,000
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.socialSecurity === 0 ? '' : deductions.socialSecurity}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('socialSecurity', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* ปรับยอดต่อเดือนตามเกณฑ์ที่เปลี่ยนไป */}
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    กำหนดอัตราหักต่อเดือน:
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">฿</span>
                    <input
                      type="number"
                      min={0}
                      max={9000}
                      step={25}
                      value={monthlySsoRate}
                      onChange={(e) => setMonthlySsoRate(Math.max(0, Number(e.target.value) || 0))}
                      className="w-20 px-2 py-0.5 text-right font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-1 focus:ring-emerald-500"
                    />
                    <span className="text-slate-400 text-[11px]">/เดือน</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onChange('socialSecurity', Math.min(9000, monthlySsoRate * 12))}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer"
                  >
                    ⚡ ใส่ 12 เดือน (฿{(monthlySsoRate * 12).toLocaleString()})
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange('socialSecurity', Math.min(9000, (deductions.socialSecurity || 0) + monthlySsoRate))}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                  >
                    +1 เดือน (฿{monthlySsoRate.toLocaleString()})
                  </button>
                  {deductions.socialSecurity > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange('socialSecurity', 0)}
                      className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      ล้างค่า
                    </button>
                  )}
                </div>
              </div>

              {deductions.socialSecurity > 9000 && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>ระบบจะนำไปคำนวณลดหย่อนตามเพดานสูงสุด 9,000 บาท</span>
                </div>
              )}
            </div>

            {/* ประกันชีวิตทั่วไป (Max 100,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เบี้ยประกันชีวิตทั่วไป / สะสมทรัพย์
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    กรมธรรม์ 10 ปีขึ้นไป (รวมกับประกันสุขภาพตนเอง สูงสุดไม่เกิน 100,000 บาท)
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  สูงสุด ฿100,000
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.lifeInsurance === 0 ? '' : deductions.lifeInsurance}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('lifeInsurance', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* ประกันสุขภาพตนเอง (Max 25,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เบี้ยประกันสุขภาพตนเอง
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 25,000 บาท (และเมื่อรวมกับประกันชีวิตต้องไม่เกิน 100,000 บาท)
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  สูงสุด ฿25,000
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.healthInsurance === 0 ? '' : deductions.healthInsurance}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('healthInsurance', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              {(deductions.lifeInsurance || 0) + Math.min(deductions.healthInsurance || 0, 25000) > 100000 && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>รวมเบี้ยประกันชีวิต + ประกันสุขภาพเกิน 100,000 บาท (คำนวณหักได้สูงสุด 100,000 บาท)</span>
                </div>
              )}
            </div>

            {/* ประกันสุขภาพบิดามารดา (Max 15,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เบี้ยประกันสุขภาพบิดามารดา
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 15,000 บาท (บิดามารดามีรายได้ไม่เกิน 30,000 บ./ปี)
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  สูงสุด ฿15,000
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.parentHealthInsurance === 0 ? '' : deductions.parentHealthInsurance}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('parentHealthInsurance', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: กองทุนเกษียณ & ThaiESG */}
      {activeTab === 'retirement' && (
        <div className="space-y-6">
          {/* Visual Progress Bar for 500k Ceiling */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  เพดานกองทุนเพื่อการเกษียณรวม (RMF + SSF + PVD + บำนาญ)
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  กฎหมายกำหนดให้ยอดรวม 4 กองทุนนี้หักลดหย่อนได้สูงสุดไม่เกิน 500,000 บาท
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs sm:text-sm font-black text-purple-600 dark:text-purple-400">
                  ฿{retirementSum.toLocaleString('th-TH')} / ฿500,000
                </span>
                <span className="text-[10px] text-slate-400 block font-medium">
                  {retirementRemaining > 0
                    ? `เหลือโควตาอีก ฿${retirementRemaining.toLocaleString('th-TH')}`
                    : '🎉 ใช้สิทธิเต็มเพดาน 500,000 บาทแล้ว'}
                </span>
              </div>
            </div>

            {/* Progress Track */}
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  retirementSum > retirementCeiling ? 'bg-amber-500' : 'bg-purple-600'
                }`}
                style={{ width: `${Math.min(100, retirementPercent)}%` }}
              />
            </div>
          </div>

          {/* 4 Retirement Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* RMF */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    กองทุน RMF
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 30% ของเงินได้พึงประเมิน และไม่เกิน 500,000 บาท
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  30% (max 500k)
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.rmf === 0 ? '' : deductions.rmf}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('rmf', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* SSF */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    กองทุน SSF
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 30% ของเงินได้พึงประเมิน และไม่เกิน 200,000 บาท
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  30% (max 200k)
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.ssf === 0 ? '' : deductions.ssf}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('ssf', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* PVD / กบข. */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    กองทุนสำรองเลี้ยงชีพ (PVD) / กบข.
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 15% ของเงินได้ และไม่เกิน 500,000 บาท
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  15% (max 500k)
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.pvd === 0 ? '' : deductions.pvd}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('pvd', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* ประกันบำนาญ */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เบี้ยประกันชีวิตแบบบำนาญ
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    สูงสุดไม่เกิน 15% ของเงินได้ และไม่เกิน 200,000 บาท
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  15% (max 200k)
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.pensionInsurance === 0 ? '' : deductions.pensionInsurance}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('pensionInsurance', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>

          {/* ThaiESG (Separate Cap 300,000) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white">
                    วงเงินพิเศษ
                  </span>
                  <h4 className="text-xs sm:text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    กองทุนรวมไทยเพื่อความยั่งยืน (ThaiESG)
                  </h4>
                </div>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                  วงเงินลดหย่อนแยกต่างหาก! ไม่นับรวมในเพดาน 500,000 บาทของกองทุนเกษียณ (สูงสุด 30% ของเงินได้ ไม่เกิน 300,000 บาท)
                </p>
              </div>

              <div className="text-right">
                <span className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300">
                  ฿{thaiEsgVal.toLocaleString('th-TH')} / ฿300,000
                </span>
                <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 block font-medium">
                  {thaiEsgRemaining > 0
                    ? `เหลือสิทธิ ฿${thaiEsgRemaining.toLocaleString('th-TH')}`
                    : 'ใช้สิทธิเต็มเพดาน 300,000 บาท'}
                </span>
              </div>
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                ฿
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={deductions.thaiEsg === 0 ? '' : deductions.thaiEsg}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('thaiEsg', e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="w-full bg-emerald-200/60 dark:bg-emerald-900/60 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-500"
                style={{ width: `${Math.min(100, thaiEsgPercent)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: อสังหาฯ บริจาค & ภาษีหัก ณ ที่จ่าย */}
      {activeTab === 'property' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ดอกเบี้ยเงินกู้บ้าน (Max 100,000) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    ดอกเบี้ยกู้ยืมเพื่อซื้อที่อยู่อาศัย
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ตามจ่ายจริง สูงสุดไม่เกิน 100,000 บาท
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  สูงสุด ฿100,000
                </span>
              </div>

              {/* GHB Sync Action & Status */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={ghbLoading}
                  onClick={handleGhbSync}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                  title="สแกนอีเมลใบเสร็จ ธอส. เพื่อดึงยอดดอกเบี้ยอัตโนมัติ"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ghbLoading ? 'animate-spin' : ''}`} />
                  {ghbLoading ? 'กำลังดึงจากอีเมล ธอส....' : 'ดึงดอกเบี้ยบ้านจากอีเมล ธอส.'}
                </button>

                {ghbReceipts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowGhbModal(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline font-medium"
                  >
                    <Info className="w-3 h-3" />
                    ดูรายละเอียด ({ghbReceipts.length} ใบเสร็จ)
                  </button>
                )}
              </div>

              {ghbMessage && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 ${
                    ghbMessage.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                  }`}
                >
                  {ghbMessage.type === 'success' ? (
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  <span>{ghbMessage.text}</span>
                </div>
              )}

              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.homeLoanInterest === 0 ? '' : deductions.homeLoanInterest}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('homeLoanInterest', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Easy E-Receipt */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    มาตรการกระตุ้นเศรษฐกิจ (Easy E-Receipt)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ค่าซื้อสินค้า/บริการตามใบกำกับภาษีอิเล็กทรอนิกส์
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  ตามที่จ่ายจริง
                </span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.easyEReceipt === 0 ? '' : deductions.easyEReceipt}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('easyEReceipt', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* บริจาคการศึกษา กีฬา รพ. (2 เท่า) */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                      บริจาคเพื่อการศึกษา กีฬา รพ.รัฐ
                    </h4>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                      ลดหย่อน 2 เท่า
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    หักลดหย่อนได้ 2 เท่าของยอดบริจาคจริง (รวมไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและลดหย่อน)
                  </p>
                </div>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.doubleDonation === 0 ? '' : deductions.doubleDonation}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('doubleDonation', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>
              {deductions.doubleDonation > 0 && (
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 block">
                  สิทธิลดหย่อน 2 เท่า: ฿{((deductions.doubleDonation || 0) * 2).toLocaleString('th-TH')}
                </span>
              )}
            </div>

            {/* บริจาคทั่วไป */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    เงินบริจาคทั่วไป (วัด มูลนิธิ ฯลฯ)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ลดหย่อนตามจ่ายจริง (เมื่อรวมกับบริจาค 2 เท่า ต้องไม่เกิน 10% ของเงินได้หลังหักค่าลดหย่อนอื่น)
                  </p>
                </div>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={deductions.generalDonation === 0 ? '' : deductions.generalDonation}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('generalDonation', e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>

          {/* ภาษีหัก ณ ที่จ่าย (Withholding Tax) */}
          {onWithholdingChange && (
            <div className="p-4 sm:p-5 rounded-2xl bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 space-y-2 mt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-sky-600 text-white">
                      เครดิตภาษี
                    </span>
                    <h4 className="text-xs sm:text-sm font-bold text-sky-900 dark:text-sky-200">
                      ภาษีหัก ณ ที่จ่ายสะสมระหว่างปี (Withholding Tax)
                    </h4>
                  </div>
                  <p className="text-[11px] text-sky-700/80 dark:text-sky-400/80 mt-0.5">
                    ภาษีที่ถูกหักและนำส่งกรมสรรพากรไว้ล่วงหน้าแล้ว (ตามใบ 50 ทวิ) นำมาหักลบออกจากภาษีที่ต้องจ่ายโดยตรง
                  </p>
                </div>
              </div>

              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-sm">
                  ฿
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={withholdingTax === 0 ? '' : withholdingTax}
                  placeholder="0.00"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                    const num = parseFloat(cleaned);
                    onWithholdingChange(isNaN(num) ? 0 : Math.max(0, num));
                  }}
                  className="w-full pl-8 pr-3 py-2 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* GH Bank Receipts Detail Modal */}
      {showGhbModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={closeGhbModal}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    รายละเอียดใบเสร็จเงินกู้ ธอส. (GH Bank)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ปีภาษี {year} (พบทั้งหมด {ghbReceipts.length} ใบเสร็จ)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeGhbModal}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt Table */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">วันที่ชำระ</th>
                      <th className="py-2.5 px-3">เลขที่บัญชี</th>
                      <th className="py-2.5 px-3 text-right">ยอดชำระรวม</th>
                      <th className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                        ดอกเบี้ย (ลดหย่อนได้)
                      </th>
                      <th className="py-2.5 px-3 text-right">เงินต้น</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-medium">
                    {ghbReceipts.map((rc, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {rc.date}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono">
                          {rc.accountNo || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                          ฿{rc.totalPaid.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                          ฿{rc.interest.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400">
                          ฿{rc.principal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 dark:bg-slate-800/80 font-bold border-t border-slate-200 dark:border-slate-800">
                    <tr>
                      <td colSpan={3} className="py-3 px-3 text-slate-900 dark:text-white">
                        ยอดรวมดอกเบี้ยที่นำไปลดหย่อนได้
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 text-sm">
                        ฿
                        {ghbReceipts
                          .reduce((sum, r) => sum + r.interest, 0)
                          .toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-500">
                        ฿
                        {ghbReceipts
                          .reduce((sum, r) => sum + r.principal, 0)
                          .toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
                * หมายเหตุ: ตามประมวลรัษฎากร กรมสรรพากรอนุญาตให้หักลดหย่อนได้เฉพาะ &quot;ดอกเบี้ย&quot; ที่จ่ายจริง ไม่เกิน 100,000 บาท (ไม่รวมส่วนที่เป็นเงินต้นหรือค่าธรรมเนียม)
              </p>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-800/30">
              <button
                type="button"
                onClick={closeGhbModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
