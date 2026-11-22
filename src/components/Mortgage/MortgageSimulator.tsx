'use client';

import { useState, useMemo } from 'react';
import { Calculator, Clock, Coins, ArrowRight } from 'lucide-react';
import { compareExtraPayment } from '@/lib/mortgage/simulator';
import { DEFAULT_INTEREST_CONFIG } from '@/lib/mortgage/types';
import type { InterestConfig } from '@/lib/mortgage/types';
import { Badge, Button, Card, Input } from '@/components/ui';

interface MortgageSimulatorProps {
  currentBalance?: number;
  interestConfig?: InterestConfig;
  accountName?: string;
  defaultBasePayment?: number;
}

const PRESET_AMOUNTS = [1000, 2000, 3000, 5000, 10000];

export default function MortgageSimulator({
  currentBalance = 2100000,
  interestConfig = DEFAULT_INTEREST_CONFIG,
  accountName = 'สินเชื่อบ้านหลัก',
  defaultBasePayment = 8500,
}: MortgageSimulatorProps) {
  const principal = Math.max(10000, currentBalance || 2100000);
  const [basePayment, setBasePayment] = useState<number>(defaultBasePayment || 8500);
  const [extraPayment, setExtraPayment] = useState<number>(3000);

  const comparison = useMemo(() => {
    return compareExtraPayment({
      principal,
      baseMonthlyPayment: Math.max(500, basePayment),
      extraMonthlyPayment: Math.max(0, extraPayment),
      interestConfig,
    });
  }, [principal, basePayment, extraPayment, interestConfig]);

  const { standard, withExtra, monthsSaved, interestSaved } = comparison;

  const stdYears = Math.floor(standard.totalMonths / 12);
  const stdMonths = standard.totalMonths % 12;

  const extraYears = Math.floor(withExtra.totalMonths / 12);
  const extraMonths = withExtra.totalMonths % 12;

  const savedYearsPart = Math.floor(monthsSaved / 12);
  const savedMonthsPart = monthsSaved % 12;

  const timeReductionPct =
    standard.totalMonths > 0 ? ((monthsSaved / standard.totalMonths) * 100).toFixed(0) : '0';
  const interestReductionPct =
    standard.totalInterest > 0
      ? ((interestSaved / standard.totalInterest) * 100).toFixed(0)
      : '0';

  return (
    <Card className="p-5 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-base font-semibold text-ink tracking-tight flex items-center gap-2">
            <Calculator className="w-4 h-4 text-accent-text shrink-0" />
            <span>เครื่องจำลองการโปะบ้าน (Extra Payment Simulator)</span>
          </h3>
          <p className="text-xs text-ink-muted mt-1">
            คำนวณผลลัพธ์แบบเรียลไทม์เมื่อจ่ายค่างวดเพิ่มขึ้นในแต่ละเดือนสำหรับ {accountName}
          </p>
        </div>

        <Badge variant="accent" className="self-start sm:self-auto py-1 px-2.5 text-xs tabular-nums">
          คำนวณจากยอดหนี้ ฿{principal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
        </Badge>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Base Monthly Payment */}
        <div className="space-y-2.5 p-4 rounded-control bg-surface-subtle/40 border border-border">
          <label
            htmlFor="mortgage-base-payment"
            className="text-xs font-medium text-ink-secondary flex justify-between gap-2"
          >
            <span>ค่างวดปกติขั้นต่ำต่อเดือน</span>
            <span className="font-semibold text-ink tabular-nums">
              ฿{basePayment.toLocaleString('th-TH')}
            </span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm font-medium pointer-events-none">
              ฿
            </span>
            <Input
              id="mortgage-base-payment"
              type="number"
              min={1000}
              step={500}
              value={basePayment}
              onChange={(e) => setBasePayment(Number(e.target.value) || 0)}
              className="pl-8 font-semibold tabular-nums"
            />
          </div>
          <p className="text-xs text-ink-muted">ยอดผ่อนชำระตามสัญญาปกติของธนาคาร</p>
        </div>

        {/* Extra Payment Slider */}
        <div className="space-y-3 p-4 rounded-control bg-accent-soft/40 border border-accent-border">
          <div className="flex justify-between items-center gap-2">
            <label htmlFor="mortgage-extra-payment" className="text-xs font-semibold text-ink">
              ยอดที่ต้องการโปะเพิ่มต่อเดือน (Extra Payment)
            </label>
            <span className="text-sm font-bold text-accent-text tabular-nums">
              +฿{extraPayment.toLocaleString('th-TH')}
            </span>
          </div>

          <input
            id="mortgage-extra-payment"
            type="range"
            min={0}
            max={30000}
            step={500}
            value={extraPayment}
            onChange={(e) => setExtraPayment(Number(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer h-2 bg-surface rounded-lg"
          />

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-ink-muted font-medium mr-1">ปุ่มลัด</span>
            {PRESET_AMOUNTS.map((amt) => {
              const active = extraPayment === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setExtraPayment(amt)}
                  aria-pressed={active}
                  className={`min-h-8 px-2.5 py-1 rounded-badge text-xs font-medium border transition-colors cursor-pointer tabular-nums ${
                    active
                      ? 'bg-accent text-accent-fg border-transparent font-semibold'
                      : 'bg-surface text-ink-secondary border-border hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  +{amt >= 1000 ? `${amt / 1000}k` : amt}
                </button>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExtraPayment(0)}
              className="text-ink-muted hover:text-expense"
            >
              รีเซ็ต
            </Button>
          </div>
        </div>
      </div>

      {/* Results Highlight Cards */}
      {extraPayment > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Time Saved */}
          <div className="p-4 sm:p-5 rounded-control bg-income-soft/50 border border-income-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-secondary flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-income" />
                <span>ระยะเวลาที่ประหยัดได้</span>
              </span>
              <Badge variant="income" className="tabular-nums">
                เร็วขึ้น {timeReductionPct}%
              </Badge>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-income tracking-tight tabular-nums">
              {savedYearsPart > 0 ? `${savedYearsPart} ปี ` : ''}
              {savedMonthsPart > 0 ? `${savedMonthsPart} เดือน` : savedYearsPart === 0 ? '0 เดือน' : ''}
            </p>
            <p className="text-xs text-ink-secondary flex items-center flex-wrap gap-1 tabular-nums">
              <span>
                จากเดิม {stdYears} ปี {stdMonths} เดือน
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              <span className="font-medium text-ink">
                เหลือเพียง {extraYears} ปี {extraMonths} เดือน
              </span>
            </p>
          </div>

          {/* Interest Saved */}
          <div className="p-4 sm:p-5 rounded-control bg-accent-soft/50 border border-accent-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-secondary flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-accent-text" />
                <span>ดอกเบี้ยที่ประหยัดได้</span>
              </span>
              <Badge variant="accent" className="tabular-nums">
                ลดลง {interestReductionPct}%
              </Badge>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-accent-text tracking-tight tabular-nums">
              ฿{interestSaved.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-ink-secondary">
              เงินในกระเป๋าที่ประหยัดได้ตลอดอายุสัญญา
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-control bg-surface-subtle/50 border border-border text-xs text-ink-muted text-center">
          เลื่อนแถบด้านบนหรือกดปุ่มลัดเพื่อดูผลลัพธ์การประหยัดดอกเบี้ยและเวลาเมื่อโปะเงินเพิ่ม
        </div>
      )}

      {/* Amortization Comparison */}
      <div className="space-y-3 pt-1">
        <h4 className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">
          เปรียบเทียบผลรวมตลอดอายุสัญญา
        </h4>

        {/* Standard Row */}
        <div className="p-4 rounded-control bg-surface-subtle/40 border border-border space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-ink-muted shrink-0" />
              <span className="font-semibold text-ink tabular-nums">
                ผ่อนแบบปกติ (฿{basePayment.toLocaleString('th-TH')}/เดือน)
              </span>
            </div>
            <div className="text-ink-secondary tabular-nums">
              ใช้เวลา <strong className="text-ink">{stdYears} ปี {stdMonths} เดือน</strong> ({standard.totalMonths} งวด)
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs text-ink-muted pt-1 border-t border-border tabular-nums">
            <span>เงินต้น: ฿{standard.totalPrincipal.toLocaleString('th-TH')}</span>
            <span className="sm:text-center">
              ดอกเบี้ยรวม:{' '}
              <span className="text-warning font-semibold">
                ฿{standard.totalInterest.toLocaleString('th-TH')}
              </span>
            </span>
            <span className="sm:text-right">
              รวมทั้งหมด: <span className="text-ink font-medium">฿{standard.totalPaid.toLocaleString('th-TH')}</span>
            </span>
          </div>
        </div>

        {/* With Extra Row */}
        <div
          className={`p-4 rounded-control border space-y-2 ${
            extraPayment > 0
              ? 'bg-income-soft/40 border-income-border'
              : 'bg-surface-subtle/40 border-border'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full bg-income shrink-0" />
              <span className="font-semibold text-ink tabular-nums">
                โปะเพิ่มเป็น (฿{(basePayment + extraPayment).toLocaleString('th-TH')}/เดือน)
              </span>
              {extraPayment > 0 && (
                <Badge variant="income" className="tabular-nums">
                  +฿{extraPayment.toLocaleString('th-TH')}
                </Badge>
              )}
            </div>
            <div className="text-ink-secondary font-medium tabular-nums">
              ใช้เวลา{' '}
              <strong className="text-income">
                {extraYears} ปี {extraMonths} เดือน
              </strong>{' '}
              ({withExtra.totalMonths} งวด)
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs text-ink-muted pt-1 border-t border-border tabular-nums">
            <span>เงินต้น: ฿{withExtra.totalPrincipal.toLocaleString('th-TH')}</span>
            <span className="sm:text-center">
              ดอกเบี้ยรวม:{' '}
              <span className="text-income font-semibold">
                ฿{withExtra.totalInterest.toLocaleString('th-TH')}
              </span>
            </span>
            <span className="sm:text-right">
              รวมทั้งหมด: <span className="text-ink font-medium">฿{withExtra.totalPaid.toLocaleString('th-TH')}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
