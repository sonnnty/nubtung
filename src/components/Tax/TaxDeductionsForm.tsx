'use client';

import React, { useState } from 'react';
import {
  Users,
  ShieldCheck,
  PiggyBank,
  Home,
  AlertTriangle,
  Info,
  TrendingUp,
  Plus,
  Minus,
  RefreshCw,
} from 'lucide-react';
import type { TaxDeductions, TaxCalculationResult } from '@/lib/tax/tax-types';
import type { GhbReceipt } from '@/lib/ghb/sync';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';
import { Alert, Badge, Button, Card, Input, Modal, formatMoney } from '@/components/ui';

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
  const [ghbMessage, setGhbMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
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
        text: `ดึงสำเร็จ ${data.receiptCount} ใบเสร็จ ยอดดอกเบี้ยรวม ฿${formatMoney(totalInterest)}`,
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
  }[] = [
    {
      id: 'family',
      label: 'ตนเองและครอบครัว',
      icon: Users,
      subtotal: result.deductionsBreakdown.personalFamily,
    },
    {
      id: 'insurance',
      label: 'ประกันและการออม',
      icon: ShieldCheck,
      subtotal: result.deductionsBreakdown.insuranceSavings,
    },
    {
      id: 'retirement',
      label: 'กองทุนเกษียณ & ThaiESG',
      icon: PiggyBank,
      subtotal: result.deductionsBreakdown.retirementGroup + result.deductionsBreakdown.thaiEsg,
    },
    {
      id: 'property',
      label: 'อสังหาฯ บริจาค & ภาษีหัก',
      icon: Home,
      subtotal: result.deductionsBreakdown.propertyEconomy + result.deductionsBreakdown.donations,
    },
  ];

  const fieldCardClass =
    'p-4 rounded-control bg-surface-subtle/40 border border-border space-y-2.5';

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      {/* Form Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-ink tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent-text shrink-0" />
            <span>รายการลดหย่อนภาษี</span>
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            ระบุสิทธิประโยชน์ทางภาษี ค่าลดหย่อนครอบครัว ประกัน กองทุน และเงินบริจาคตามสิทธิที่กฎหมายกำหนด
          </p>
        </div>

        <div className="px-3.5 py-2 rounded-control bg-surface-subtle border border-border flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-ink-muted font-medium">ลดหย่อนรวม</span>
          <span className="text-sm font-semibold text-accent-text tabular-nums">
            ฿{formatMoney(result.totalDeductions)}
          </span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div role="tablist" aria-label="หมวดหมู่ค่าลดหย่อน" className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`p-3.5 rounded-control border text-left transition-colors duration-150 cursor-pointer flex flex-col justify-between gap-2.5 ${
                isActive
                  ? 'bg-accent-soft border-accent-border text-ink'
                  : 'bg-surface-subtle/40 border-border text-ink-secondary hover:bg-surface-subtle hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-7 h-7 rounded-badge border flex items-center justify-center shrink-0 ${
                    isActive
                      ? 'bg-accent text-accent-fg border-transparent'
                      : 'bg-surface text-ink-muted border-border'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs leading-tight line-clamp-1 ${isActive ? 'font-semibold text-ink' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-2 border-t border-border">
                <span className="text-[11px] text-ink-muted">ลดหย่อนได้</span>
                <span className={`text-xs font-semibold tabular-nums ${isActive ? 'text-accent-text' : 'text-ink'}`}>
                  ฿{tab.subtotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ตนเองและครอบครัว */}
      {activeTab === 'family' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ตนเอง (Fixed 60,000) */}
          <div className={fieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  ลดหย่อนส่วนตัว (ตนเอง)
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  ผู้มีเงินได้ทุกคนได้รับสิทธิลดหย่อนอัตโนมัติตามกฎหมาย
                </p>
              </div>
              <Badge variant="income">สิทธิคงที่</Badge>
            </div>
            <Input
              type="text"
              disabled
              aria-label="ลดหย่อนส่วนตัว"
              value="฿60,000.00"
              className="font-semibold tabular-nums"
            />
          </div>

          {/* คู่สมรสไม่มีเงินได้ */}
          <div className={`${fieldCardClass} flex flex-col justify-between`}>
            <div>
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  คู่สมรสที่ไม่มีเงินได้
                </h4>
                <span className="text-xs font-medium text-ink-muted shrink-0">
                  ลดหย่อน 60,000 บาท
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">
                จดทะเบียนสมรสถูกต้องตามกฎหมาย และคู่สมรสไม่มีเงินได้พึงประเมิน
              </p>
            </div>

            <label className="flex items-center gap-3 min-h-10 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={Boolean(deductions.spouse)}
                onChange={(e) => onChange('spouse', e.target.checked ? 60000 : 0)}
                className="w-4 h-4 rounded-badge accent-[var(--accent)] border-border-strong cursor-pointer"
              />
              <span className="text-xs font-medium text-ink">
                {deductions.spouse
                  ? 'มีคู่สมรสไม่มีเงินได้ (ใช้สิทธิลดหย่อน ฿60,000)'
                  : 'ไม่มี / ไม่ได้ใช้สิทธินี้'}
              </span>
            </label>
          </div>

          {/* บุตรทั่วไป */}
          <div className={fieldCardClass}>
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-ink">
                จำนวนบุตร (ทั่วไป / เกิดก่อนปี 61)
              </h4>
              <p className="text-xs text-ink-muted mt-0.5">
                ลดหย่อนคนละ 30,000 บาท (อายุไม่เกิน 20 ปี หรือศึกษาอยู่ไม่เกิน 25 ปี)
              </p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('childCount', -1)}
                  aria-label="ลดจำนวนบุตรทั่วไป"
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-14 text-center text-sm font-semibold text-ink tabular-nums">
                  {deductions.childCount || 0} คน
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('childCount', 1)}
                  aria-label="เพิ่มจำนวนบุตรทั่วไป"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <span className="text-xs sm:text-sm font-semibold text-accent-text tabular-nums">
                ฿{((deductions.childCount || 0) * 30000).toLocaleString('th-TH')}
              </span>
            </div>
          </div>

          {/* บุตรคนที่ 2 ขึ้นไปเกิดปี 2561+ */}
          <div className={fieldCardClass}>
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-ink">
                บุตรคนที่ 2 ขึ้นไปเกิดปี 2561+
              </h4>
              <p className="text-xs text-ink-muted mt-0.5">
                ลดหย่อนคนละ 60,000 บาท ตามมาตรการสนับสนุนการมีบุตร
              </p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('child2018Count', -1)}
                  aria-label="ลดจำนวนบุตรเกิดปี 2561 ขึ้นไป"
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-14 text-center text-sm font-semibold text-ink tabular-nums">
                  {deductions.child2018Count || 0} คน
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('child2018Count', 1)}
                  aria-label="เพิ่มจำนวนบุตรเกิดปี 2561 ขึ้นไป"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <span className="text-xs sm:text-sm font-semibold text-accent-text tabular-nums">
                ฿{((deductions.child2018Count || 0) * 60000).toLocaleString('th-TH')}
              </span>
            </div>
          </div>

          {/* บิดามารดา */}
          <div className={fieldCardClass}>
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-ink">
                อุปการะบิดามารดา (อายุ 60 ปีขึ้นไป)
              </h4>
              <p className="text-xs text-ink-muted mt-0.5">
                คนละ 30,000 บาท สูงสุด 4 คน (ตนเอง 2 + คู่สมรส 2) มีรายได้ไม่เกิน 30,000 บ./ปี
              </p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('parentCount', -1, 0, 4)}
                  aria-label="ลดจำนวนบิดามารดา"
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-14 text-center text-sm font-semibold text-ink tabular-nums">
                  {deductions.parentCount || 0} คน
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('parentCount', 1, 0, 4)}
                  aria-label="เพิ่มจำนวนบิดามารดา"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <span className="text-xs sm:text-sm font-semibold text-accent-text tabular-nums">
                ฿{((deductions.parentCount || 0) * 30000).toLocaleString('th-TH')}
              </span>
            </div>
          </div>

          {/* ผู้พิการ */}
          <div className={fieldCardClass}>
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-ink">
                อุปการะผู้พิการหรือทุพพลภาพ
              </h4>
              <p className="text-xs text-ink-muted mt-0.5">
                ลดหย่อนคนละ 60,000 บาท (มีบัตรประจำตัวคนพิการ)
              </p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('disabledCount', -1)}
                  aria-label="ลดจำนวนผู้พิการในอุปการะ"
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-14 text-center text-sm font-semibold text-ink tabular-nums">
                  {deductions.disabledCount || 0} คน
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => handleStepper('disabledCount', 1)}
                  aria-label="เพิ่มจำนวนผู้พิการในอุปการะ"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <span className="text-xs sm:text-sm font-semibold text-accent-text tabular-nums">
                ฿{((deductions.disabledCount || 0) * 60000).toLocaleString('th-TH')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ประกันและการออม */}
      {activeTab === 'insurance' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ประกันสังคม */}
          <div className={fieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  เงินสมทบกองทุนประกันสังคม
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  ตามจ่ายจริง สูงสุดไม่เกิน 9,000 บาท/ปี
                </p>
              </div>
              <Badge variant="neutral" className="tabular-nums">สูงสุด ฿9,000</Badge>
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                ฿
              </span>
              <Input
                type="text"
                inputMode="decimal"
                aria-label="เงินสมทบกองทุนประกันสังคม"
                value={deductions.socialSecurity === 0 ? '' : deductions.socialSecurity}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('socialSecurity', e.target.value)}
                className="pl-8 font-semibold tabular-nums"
              />
            </div>

            <div className="pt-2.5 border-t border-border space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-secondary font-medium">กำหนดอัตราหักต่อเดือน</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-ink-muted">฿</span>
                  <Input
                    type="number"
                    min={0}
                    max={9000}
                    step={25}
                    aria-label="อัตราหักประกันสังคมต่อเดือน"
                    value={monthlySsoRate}
                    onChange={(e) => setMonthlySsoRate(Math.max(0, Number(e.target.value) || 0))}
                    className="w-24 min-h-8 py-1 px-2 text-right text-xs font-semibold tabular-nums"
                  />
                  <span className="text-ink-muted">/เดือน</span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onChange('socialSecurity', Math.min(9000, monthlySsoRate * 12))}
                  className="tabular-nums"
                >
                  ใส่ 12 เดือน (฿{(monthlySsoRate * 12).toLocaleString('th-TH')})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onChange(
                      'socialSecurity',
                      Math.min(9000, (deductions.socialSecurity || 0) + monthlySsoRate)
                    )
                  }
                  className="tabular-nums"
                >
                  +1 เดือน (฿{monthlySsoRate.toLocaleString('th-TH')})
                </Button>
                {deductions.socialSecurity > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange('socialSecurity', 0)}
                    className="text-ink-muted hover:text-expense"
                  >
                    ล้างค่า
                  </Button>
                )}
              </div>
            </div>

            {deductions.socialSecurity > 9000 && (
              <div className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>ระบบจะนำไปคำนวณลดหย่อนตามเพดานสูงสุด 9,000 บาท</span>
              </div>
            )}
          </div>

          {/* ประกันชีวิตทั่วไป */}
          <div className={fieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  เบี้ยประกันชีวิตทั่วไป / สะสมทรัพย์
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  กรมธรรม์ 10 ปีขึ้นไป (รวมกับประกันสุขภาพตนเอง สูงสุดไม่เกิน 100,000 บาท)
                </p>
              </div>
              <Badge variant="neutral" className="tabular-nums">สูงสุด ฿100,000</Badge>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                ฿
              </span>
              <Input
                type="text"
                inputMode="decimal"
                aria-label="เบี้ยประกันชีวิตทั่วไป"
                value={deductions.lifeInsurance === 0 ? '' : deductions.lifeInsurance}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('lifeInsurance', e.target.value)}
                className="pl-8 font-semibold tabular-nums"
              />
            </div>
          </div>

          {/* ประกันสุขภาพตนเอง */}
          <div className={fieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  เบี้ยประกันสุขภาพตนเอง
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  สูงสุดไม่เกิน 25,000 บาท (และเมื่อรวมกับประกันชีวิตต้องไม่เกิน 100,000 บาท)
                </p>
              </div>
              <Badge variant="neutral" className="tabular-nums">สูงสุด ฿25,000</Badge>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                ฿
              </span>
              <Input
                type="text"
                inputMode="decimal"
                aria-label="เบี้ยประกันสุขภาพตนเอง"
                value={deductions.healthInsurance === 0 ? '' : deductions.healthInsurance}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('healthInsurance', e.target.value)}
                className="pl-8 font-semibold tabular-nums"
              />
            </div>
            {(deductions.lifeInsurance || 0) + Math.min(deductions.healthInsurance || 0, 25000) >
              100000 && (
              <div className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  รวมเบี้ยประกันชีวิตและประกันสุขภาพเกิน 100,000 บาท (คำนวณหักได้สูงสุด 100,000 บาท)
                </span>
              </div>
            )}
          </div>

          {/* ประกันสุขภาพบิดามารดา */}
          <div className={fieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  เบี้ยประกันสุขภาพบิดามารดา
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  สูงสุดไม่เกิน 15,000 บาท (บิดามารดามีรายได้ไม่เกิน 30,000 บ./ปี)
                </p>
              </div>
              <Badge variant="neutral" className="tabular-nums">สูงสุด ฿15,000</Badge>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                ฿
              </span>
              <Input
                type="text"
                inputMode="decimal"
                aria-label="เบี้ยประกันสุขภาพบิดามารดา"
                value={deductions.parentHealthInsurance === 0 ? '' : deductions.parentHealthInsurance}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('parentHealthInsurance', e.target.value)}
                className="pl-8 font-semibold tabular-nums"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: กองทุนเกษียณ & ThaiESG */}
      {activeTab === 'retirement' && (
        <div className="space-y-5">
          {/* 500k Ceiling Progress */}
          <div className="p-4 rounded-control bg-surface-subtle/60 border border-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-accent-text shrink-0" />
                  <span>เพดานกองทุนเพื่อการเกษียณรวม (RMF + SSF + PVD + บำนาญ)</span>
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  กฎหมายกำหนดให้ยอดรวม 4 กองทุนนี้หักลดหย่อนได้สูงสุดไม่เกิน 500,000 บาท
                </p>
              </div>
              <div className="text-left sm:text-right shrink-0 tabular-nums">
                <span className="text-sm font-semibold text-ink">
                  ฿{retirementSum.toLocaleString('th-TH')} / ฿500,000
                </span>
                <span className="text-xs text-ink-muted block">
                  {retirementRemaining > 0
                    ? `เหลือโควตาอีก ฿${retirementRemaining.toLocaleString('th-TH')}`
                    : 'ใช้สิทธิเต็มเพดาน 500,000 บาทแล้ว'}
                </span>
              </div>
            </div>

            <div className="w-full bg-surface-subtle border border-border rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  retirementSum > retirementCeiling ? 'bg-warning' : 'bg-accent'
                }`}
                style={{ width: `${Math.min(100, retirementPercent)}%` }}
              />
            </div>
          </div>

          {/* 4 Retirement Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">กองทุน RMF</h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    สูงสุดไม่เกิน 30% ของเงินได้พึงประเมิน และไม่เกิน 500,000 บาท
                  </p>
                </div>
                <Badge variant="neutral">30% (max 500k)</Badge>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="กองทุน RMF"
                  value={deductions.rmf === 0 ? '' : deductions.rmf}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('rmf', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>

            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">กองทุน SSF</h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    สูงสุดไม่เกิน 30% ของเงินได้พึงประเมิน และไม่เกิน 200,000 บาท
                  </p>
                </div>
                <Badge variant="neutral">30% (max 200k)</Badge>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="กองทุน SSF"
                  value={deductions.ssf === 0 ? '' : deductions.ssf}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('ssf', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>

            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    กองทุนสำรองเลี้ยงชีพ (PVD) / กบข.
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    สูงสุดไม่เกิน 15% ของเงินได้ และไม่เกิน 500,000 บาท
                  </p>
                </div>
                <Badge variant="neutral">15% (max 500k)</Badge>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="กองทุนสำรองเลี้ยงชีพ"
                  value={deductions.pvd === 0 ? '' : deductions.pvd}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('pvd', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>

            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    เบี้ยประกันชีวิตแบบบำนาญ
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    สูงสุดไม่เกิน 15% ของเงินได้ และไม่เกิน 200,000 บาท
                  </p>
                </div>
                <Badge variant="neutral">15% (max 200k)</Badge>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="เบี้ยประกันชีวิตแบบบำนาญ"
                  value={deductions.pensionInsurance === 0 ? '' : deductions.pensionInsurance}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('pensionInsurance', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* ThaiESG (Separate Cap 300,000) */}
          <div className="p-4 sm:p-5 rounded-control bg-accent-soft/50 border border-accent-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="accent">วงเงินแยก</Badge>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    กองทุนรวมไทยเพื่อความยั่งยืน (ThaiESG)
                  </h4>
                </div>
                <p className="text-xs text-ink-secondary mt-1">
                  วงเงินลดหย่อนแยกต่างหาก ไม่นับรวมในเพดาน 500,000 บาทของกองทุนเกษียณ (สูงสุด 30% ของเงินได้ ไม่เกิน 300,000 บาท)
                </p>
              </div>

              <div className="text-left sm:text-right shrink-0 tabular-nums">
                <span className="text-sm font-semibold text-accent-text">
                  ฿{thaiEsgVal.toLocaleString('th-TH')} / ฿300,000
                </span>
                <span className="text-xs text-ink-muted block">
                  {thaiEsgRemaining > 0
                    ? `เหลือสิทธิ ฿${thaiEsgRemaining.toLocaleString('th-TH')}`
                    : 'ใช้สิทธิเต็มเพดาน 300,000 บาท'}
                </span>
              </div>
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                ฿
              </span>
              <Input
                type="text"
                inputMode="decimal"
                aria-label="กองทุน ThaiESG"
                value={deductions.thaiEsg === 0 ? '' : deductions.thaiEsg}
                placeholder="0.00"
                onChange={(e) => handleNumberInput('thaiEsg', e.target.value)}
                className="pl-8 font-semibold tabular-nums"
              />
            </div>

            <div className="w-full bg-surface border border-accent-border rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
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
            {/* ดอกเบี้ยเงินกู้บ้าน */}
            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    ดอกเบี้ยกู้ยืมเพื่อซื้อที่อยู่อาศัย
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    ตามจ่ายจริง สูงสุดไม่เกิน 100,000 บาท
                  </p>
                </div>
                <Badge variant="neutral" className="tabular-nums">สูงสุด ฿100,000</Badge>
              </div>

              {/* GHB Sync Action */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ghbLoading}
                  onClick={handleGhbSync}
                  title="สแกนอีเมลใบเสร็จ ธอส. เพื่อดึงยอดดอกเบี้ยอัตโนมัติ"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ghbLoading ? 'animate-spin' : ''}`} />
                  <span>
                    {ghbLoading ? 'กำลังดึงจากอีเมล ธอส....' : 'ดึงดอกเบี้ยบ้านจากอีเมล ธอส.'}
                  </span>
                </Button>

                {ghbReceipts.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowGhbModal(true)}
                    className="text-accent-text"
                  >
                    <Info className="w-3.5 h-3.5" />
                    <span>ดูรายละเอียด ({ghbReceipts.length} ใบเสร็จ)</span>
                  </Button>
                )}
              </div>

              {ghbMessage && (
                <Alert variant={ghbMessage.type === 'success' ? 'success' : 'error'}>
                  {ghbMessage.text}
                </Alert>
              )}

              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="ดอกเบี้ยกู้ยืมเพื่อซื้อที่อยู่อาศัย"
                  value={deductions.homeLoanInterest === 0 ? '' : deductions.homeLoanInterest}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('homeLoanInterest', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>

            {/* Easy E-Receipt */}
            <div className={fieldCardClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    มาตรการกระตุ้นเศรษฐกิจ (Easy E-Receipt)
                  </h4>
                  <p className="text-xs text-ink-muted mt-0.5">
                    ค่าซื้อสินค้า/บริการตามใบกำกับภาษีอิเล็กทรอนิกส์
                  </p>
                </div>
                <Badge variant="neutral">ตามที่จ่ายจริง</Badge>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="Easy E-Receipt"
                  value={deductions.easyEReceipt === 0 ? '' : deductions.easyEReceipt}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('easyEReceipt', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>

            {/* บริจาค 2 เท่า */}
            <div className={fieldCardClass}>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    บริจาคเพื่อการศึกษา กีฬา รพ.รัฐ
                  </h4>
                  <Badge variant="accent">ลดหย่อน 2 เท่า</Badge>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  หักลดหย่อนได้ 2 เท่าของยอดบริจาคจริง (รวมไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและลดหย่อน)
                </p>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="บริจาคเพื่อการศึกษา กีฬา รพ.รัฐ"
                  value={deductions.doubleDonation === 0 ? '' : deductions.doubleDonation}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('doubleDonation', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
              {deductions.doubleDonation > 0 && (
                <span className="text-xs font-medium text-income block tabular-nums">
                  สิทธิลดหย่อน 2 เท่า: ฿{((deductions.doubleDonation || 0) * 2).toLocaleString('th-TH')}
                </span>
              )}
            </div>

            {/* บริจาคทั่วไป */}
            <div className={fieldCardClass}>
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-ink">
                  เงินบริจาคทั่วไป (วัด มูลนิธิ ฯลฯ)
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  ลดหย่อนตามจ่ายจริง (เมื่อรวมกับบริจาค 2 เท่า ต้องไม่เกิน 10% ของเงินได้หลังหักค่าลดหย่อนอื่น)
                </p>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="เงินบริจาคทั่วไป"
                  value={deductions.generalDonation === 0 ? '' : deductions.generalDonation}
                  placeholder="0.00"
                  onChange={(e) => handleNumberInput('generalDonation', e.target.value)}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* ภาษีหัก ณ ที่จ่าย */}
          {onWithholdingChange && (
            <div className="p-4 sm:p-5 rounded-control bg-transfer-soft/60 border border-transfer-border space-y-2.5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="transfer">เครดิตภาษี</Badge>
                  <h4 className="text-xs sm:text-sm font-semibold text-ink">
                    ภาษีหัก ณ ที่จ่ายสะสมระหว่างปี (Withholding Tax)
                  </h4>
                </div>
                <p className="text-xs text-ink-secondary mt-1">
                  ภาษีที่ถูกหักและนำส่งกรมสรรพากรไว้ล่วงหน้าแล้ว (ตามใบ 50 ทวิ) นำมาหักลบออกจากภาษีที่ต้องจ่ายโดยตรง
                </p>
              </div>

              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-muted font-medium text-sm pointer-events-none">
                  ฿
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="ภาษีหัก ณ ที่จ่ายสะสมระหว่างปี"
                  value={withholdingTax === 0 ? '' : withholdingTax}
                  placeholder="0.00"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                    const num = parseFloat(cleaned);
                    onWithholdingChange(isNaN(num) ? 0 : Math.max(0, num));
                  }}
                  className="pl-8 font-semibold tabular-nums"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* GH Bank Receipts Detail Modal */}
      <Modal
        isOpen={showGhbModal}
        onClose={closeGhbModal}
        title="รายละเอียดใบเสร็จเงินกู้ ธอส. (GH Bank)"
        description={`ปีภาษี ${year} (พบทั้งหมด ${ghbReceipts.length} ใบเสร็จ)`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={closeGhbModal}>
            ปิดหน้าต่าง
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-control border border-border">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-surface-subtle text-ink-secondary font-medium border-b border-border">
                <tr>
                  <th className="py-2.5 px-3 whitespace-nowrap">วันที่ชำระ</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">เลขที่บัญชี</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดชำระรวม</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-income font-semibold">
                    ดอกเบี้ย (ลดหย่อนได้)
                  </th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">เงินต้น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {ghbReceipts.map((rc, idx) => (
                  <tr key={idx} className="hover:bg-surface-subtle/50">
                    <td className="py-2.5 px-3 text-ink whitespace-nowrap">{rc.date}</td>
                    <td className="py-2.5 px-3 text-ink-muted whitespace-nowrap font-mono">
                      {rc.accountNo || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-ink-secondary">
                      ฿{formatMoney(rc.totalPaid)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-income font-semibold">
                      ฿{formatMoney(rc.interest)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-ink-muted">
                      ฿{formatMoney(rc.principal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-subtle font-semibold border-t border-border tabular-nums">
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-ink">
                    ยอดรวมดอกเบี้ยที่นำไปลดหย่อนได้
                  </td>
                  <td className="py-3 px-3 text-right text-income text-sm">
                    ฿{formatMoney(ghbReceipts.reduce((sum, r) => sum + r.interest, 0))}
                  </td>
                  <td className="py-3 px-3 text-right text-ink-muted">
                    ฿{formatMoney(ghbReceipts.reduce((sum, r) => sum + r.principal, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-ink-muted leading-relaxed">
            หมายเหตุ: ตามประมวลรัษฎากร กรมสรรพากรอนุญาตให้หักลดหย่อนได้เฉพาะ &ldquo;ดอกเบี้ย&rdquo; ที่จ่ายจริง ไม่เกิน 100,000 บาท (ไม่รวมส่วนที่เป็นเงินต้นหรือค่าธรรมเนียม)
          </p>
        </div>
      </Modal>
    </Card>
  );
}
