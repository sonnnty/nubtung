'use client';

import React from 'react';
import { RefreshCw, Sliders, Info, Layers, ShieldCheck, Search } from 'lucide-react';
import type { IncomeBySection, TaxBreakdownTransaction } from '@/lib/tax/tax-types';
import { Alert, Badge, Button, Card, Input, formatMoney } from '@/components/ui';

interface TaxIncomeFormProps {
  income: IncomeBySection;
  expenses: Record<keyof IncomeBySection, number>;
  onChange: (key: keyof IncomeBySection, value: number) => void;
  isManualOverride: boolean;
  onToggleOverride: () => void;
  onResetSynced: () => void;
  transactionsBySection?: Record<keyof IncomeBySection, TaxBreakdownTransaction[]>;
  exemptTransactions?: TaxBreakdownTransaction[];
  excludedTransactionIds?: Set<string>;
  onOpenBreakdown?: (sectionKey: keyof IncomeBySection | 'exempt', title: string) => void;
}

interface SectionMeta {
  key: keyof IncomeBySection;
  code: string;
  title: string;
  subtitle: string;
  rule: string;
  expenseRateText: string;
}

const SECTION_METAS: SectionMeta[] = [
  {
    key: 'section40_1',
    code: '40(1)',
    title: 'เงินเดือน โบนัส ค่าจ้าง',
    subtitle: 'เงินได้จากการจ้างแรงงาน รายได้ประจำตามมาตรา 40(1)',
    rule: 'หักรวมกับ 40(2) ได้ 50% สูงสุดไม่เกิน 100,000 บาท',
    expenseRateText: '50% (รวม 40(2) สูงสุด 100k)',
  },
  {
    key: 'section40_2',
    code: '40(2)',
    title: 'ฟรีแลนซ์ ค่านายหน้า เบี้ยประชุม',
    subtitle: 'เงินได้จากหน้าที่หรือตำแหน่งงานที่ทำ หรือรับจ้างทำงาน',
    rule: 'หักรวมกับ 40(1) ได้ 50% สูงสุดไม่เกิน 100,000 บาท',
    expenseRateText: '50% (รวม 40(1) สูงสุด 100k)',
  },
  {
    key: 'section40_3',
    code: '40(3)',
    title: 'ค่าสิทธิ ค่าลิขสิทธิ์ สิทธิบัตร',
    subtitle: 'ค่าความนิยม สิทธิบัตร ทรัพย์สินทางปัญญา หรือสิทธิอื่นๆ',
    rule: 'หักค่าใช้จ่ายได้ 50% สูงสุดไม่เกิน 100,000 บาท',
    expenseRateText: '50% (สูงสุด 100k)',
  },
  {
    key: 'section40_4',
    code: '40(4)',
    title: 'ดอกเบี้ย เงินปันผล คริปโทฯ',
    subtitle: 'ดอกเบี้ยเงินฝาก/หุ้นกู้ เงินปันผลกองทุน/หุ้น ผลกำไรสินทรัพย์ดิจิทัล',
    rule: 'กฎหมายไม่อนุญาตให้หักค่าใช้จ่าย (หักได้ 0%)',
    expenseRateText: 'หักไม่ได้ (0%)',
  },
  {
    key: 'section40_5',
    code: '40(5)',
    title: 'ค่าเช่าทรัพย์สิน บ้าน ที่ดิน รถยนต์',
    subtitle: 'เงินได้จากการให้เช่าทรัพย์สิน หรือการผิดสัญญาเช่าซื้อ',
    rule: 'หักเหมาค่าใช้จ่ายได้ 30% (หรือหักตามจริงพร้อมหลักฐาน)',
    expenseRateText: 'หักเหมา 30%',
  },
  {
    key: 'section40_6',
    code: '40(6)',
    title: 'วิชาชีพอิสระ',
    subtitle: 'ประกอบโรคศิลปะ กฎหมาย วิศวกรรม สถาปัตยกรรม บัญชี ประณีตศิลปกรรม',
    rule: 'หักเหมาค่าใช้จ่ายได้ 30% (หรือ 60% สำหรับประกอบโรคศิลปะ)',
    expenseRateText: 'หักเหมา 30% (แพทย์ 60%)',
  },
  {
    key: 'section40_7',
    code: '40(7)',
    title: 'ค่ารับเหมาทั้งค่าแรงและของ',
    subtitle: 'การรับเหมาที่ผู้รับเหมาต้องลงทุนจัดหาสัมภาระในส่วนสำคัญนอกจากเครื่องมือ',
    rule: 'หักเหมาค่าใช้จ่ายได้ 60% (หรือหักตามจริงพร้อมหลักฐาน)',
    expenseRateText: 'หักเหมา 60%',
  },
  {
    key: 'section40_8',
    code: '40(8)',
    title: 'ธุรกิจ การค้า พาณิชย์ หรืออื่นๆ',
    subtitle: 'เงินได้จากการพาณิชย์ การเกษตร การอุตสาหกรรม หรือเงินได้อื่นที่ไม่เข้าพวก',
    rule: 'หักเหมาค่าใช้จ่ายได้ 60% สำหรับ 43 ประเภทธุรกิจที่ระบุ หรือหักตามจริง',
    expenseRateText: 'หักเหมา 60%',
  },
];

export default function TaxIncomeForm({
  income,
  expenses,
  onChange,
  isManualOverride,
  onToggleOverride,
  onResetSynced,
  transactionsBySection,
  exemptTransactions = [],
  onOpenBreakdown,
}: TaxIncomeFormProps) {
  const totalIncomeCalculated = Object.values(income).reduce((acc, val) => acc + (val || 0), 0);
  const totalExemptAmount = exemptTransactions.reduce(
    (sum, tx) => sum + (Number(tx.amount) || 0),
    0
  );

  const handleInputChange = (key: keyof IncomeBySection, rawValue: string) => {
    const cleaned = rawValue.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    onChange(key, isNaN(num) ? 0 : Math.max(0, num));
  };

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      {/* Header & Mode Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Layers className="w-4 h-4 text-accent-text shrink-0" />
            <h2 className="text-base font-semibold text-ink tracking-tight">
              เงินได้พึงประเมิน 8 ประเภท (มาตรา 40)
            </h2>
            <Badge variant="neutral">ปีภาษีปัจจุบัน</Badge>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            ระบุยอดเงินได้พึงประเมินในแต่ละหมวด ระบบจะคำนวณหักค่าใช้จ่ายตามสัดส่วนที่กฎหมายกำหนดให้อัตโนมัติ
          </p>
        </div>

        {/* Sync / Override Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={isManualOverride ? 'primary' : 'secondary'}
            size="sm"
            onClick={onToggleOverride}
            aria-pressed={isManualOverride}
            title="สลับระหว่างใช้ยอดอัตโนมัติจากรายการธุรกรรม หรือกำหนดเอง"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{isManualOverride ? 'โหมดกำหนดเอง (Manual)' : 'โหมดซิงก์อัตโนมัติ'}</span>
          </Button>

          {isManualOverride && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onResetSynced}
              title="รีเซ็ตยอดกลับไปใช้ตัวเลขที่คำนวณได้จากรายการธุรกรรม"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>รีเซ็ตตามธุรกรรม</span>
            </Button>
          )}
        </div>
      </div>

      {/* Sync Status Banner */}
      <Alert
        variant={isManualOverride ? 'warning' : 'info'}
        action={
          <span className="text-xs font-semibold text-ink tabular-nums hidden md:inline">
            รวมเงินได้ ฿{formatMoney(totalIncomeCalculated)}
          </span>
        }
      >
        {isManualOverride
          ? 'คุณเปิดใช้งานโหมดกำหนดเอง คุณสามารถแก้ไขตัวเลขในแต่ละประเภทได้อย่างอิสระ'
          : 'ข้อมูลรายได้เชื่อมโยงกับธุรกรรมรายรับในระบบโดยอัตโนมัติ หากต้องการปรับแต่งให้คลิกปุ่มโหมดกำหนดเอง'}
      </Alert>

      {/* Form List of 8 Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
        {SECTION_METAS.map((section) => {
          const currentAmount = income[section.key] || 0;
          const currentExpense = expenses[section.key] || 0;

          const activeList = transactionsBySection?.[section.key] || [];
          const userExcludedList = exemptTransactions.filter(
            (tx) => tx.section === section.key && tx.isUserExcluded && !tx.isExempt
          );
          const totalSectionTxCount = activeList.length + userExcludedList.length;
          const excludedCount = userExcludedList.length;

          return (
            <div
              key={section.key}
              className="p-4 rounded-control bg-surface-subtle/40 border border-border flex flex-col justify-between gap-3"
            >
              {/* Header of Section */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="accent" className="font-semibold">
                      {section.code}
                    </Badge>
                    <h3 className="text-xs sm:text-sm font-semibold text-ink truncate">
                      {section.title}
                    </h3>
                  </div>

                  <span className="text-[11px] font-medium text-ink-muted shrink-0">
                    {section.expenseRateText}
                  </span>
                </div>

                <p className="text-xs text-ink-muted line-clamp-1">{section.subtitle}</p>
              </div>

              {/* Transaction count badge & Breakdown modal trigger */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="neutral" className="tabular-nums">
                    {totalSectionTxCount} รายการ
                  </Badge>
                  {excludedCount > 0 && (
                    <Badge variant="expense" className="tabular-nums">
                      ยกเว้น {excludedCount} รายการ
                    </Badge>
                  )}
                </div>

                {onOpenBreakdown && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenBreakdown(section.key, section.title)}
                    title={`ดูรายการธุรกรรมของ ${section.code}`}
                    className="text-xs tabular-nums shrink-0"
                  >
                    <Search className="w-3.5 h-3.5 text-ink-muted" />
                    <span>ดูรายการ ({totalSectionTxCount})</span>
                  </Button>
                )}
              </div>

              {/* Input and Live Expense Badge */}
              <div className="space-y-2">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-muted font-medium text-sm">
                    ฿
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${section.code} ${section.title}`}
                    value={currentAmount === 0 ? '' : currentAmount}
                    placeholder="0.00"
                    onChange={(e) => handleInputChange(section.key, e.target.value)}
                    className="pl-8 font-semibold tabular-nums"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-ink-muted flex items-center gap-1 min-w-0 truncate">
                    <Info className="w-3 h-3 shrink-0" />
                    <span className="truncate">{section.rule}</span>
                  </span>

                  <Badge
                    variant={currentExpense > 0 ? 'income' : 'neutral'}
                    className="tabular-nums shrink-0"
                  >
                    หักค่าใช้จ่าย ฿{formatMoney(currentExpense)}
                  </Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Non-Taxable / Exempt Income Card */}
      <div className="p-4 sm:p-5 rounded-card bg-surface-subtle/60 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-control bg-surface border border-border text-ink-secondary flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-ink">
              รายรับที่ได้รับยกเว้นภาษี (Non-Taxable / Exempt Income)
            </h3>
            <Badge variant="neutral" className="tabular-nums">
              {exemptTransactions.length} รายการ
            </Badge>
          </div>

          <p className="text-xs text-ink-muted leading-relaxed">
            ระบบคัดกรองเงินกู้บ้าน/ส่วนต่าง เงินอุปการะจากพ่อแม่ตาม ม.42(26) และเงินแชร์ค่าใช้จ่ายออกให้อัตโนมัติ ไม่นำมารวมเป็นฐานภาษี
          </p>
        </div>

        <div className="flex sm:flex-col items-center md:items-end justify-between md:justify-center gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-border">
          <div className="text-left md:text-right">
            <span className="text-xs text-ink-muted block">ยอดยกเว้นภาษีรวม</span>
            <p className="text-lg sm:text-2xl font-bold text-ink tracking-tight tabular-nums">
              ฿{formatMoney(totalExemptAmount)}
            </p>
          </div>

          {onOpenBreakdown && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onOpenBreakdown('exempt', 'รายรับที่ได้รับยกเว้นภาษี (Non-Taxable Income)')
              }
              title="ดูรายการธุรกรรมที่ได้รับการยกเว้นภาษีทั้งหมด"
            >
              <Search className="w-3.5 h-3.5" />
              <span>ดูรายการยกเว้น ({exemptTransactions.length} รายการ)</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
