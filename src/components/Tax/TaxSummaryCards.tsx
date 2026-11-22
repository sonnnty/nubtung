'use client';

import {
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  Coins,
  Receipt,
  Calculator,
  Percent,
} from 'lucide-react';
import type { TaxCalculationResult } from '@/lib/tax/tax-types';
import { Badge, Card } from '@/components/ui';

interface TaxSummaryCardsProps {
  result: TaxCalculationResult;
  loading?: boolean;
}

const formatMoney = (amount: number) =>
  amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TaxSummaryCards({ result, loading = false }: TaxSummaryCardsProps) {
  const isRefund = result.isRefund;
  const netAmount = Math.abs(result.netTaxPayable);
  const isZeroTax = result.netTaxPayable === 0;

  const statusConfig = isRefund
    ? {
        borderAccent: 'border-l-4 border-l-income',
        iconWrap: 'bg-income-soft text-income border-income-border',
        badgeVariant: 'income' as const,
        badgeLabel: 'ได้รับเงินคืนภาษี',
        amountColor: 'text-income',
      }
    : isZeroTax
    ? {
        borderAccent: 'border-l-4 border-l-accent',
        iconWrap: 'bg-accent-soft text-accent-text border-accent-border',
        badgeVariant: 'neutral' as const,
        badgeLabel: 'ไม่ต้องเสียภาษีเพิ่ม',
        amountColor: 'text-ink',
      }
    : {
        borderAccent: 'border-l-4 border-l-expense',
        iconWrap: 'bg-expense-soft text-expense border-expense-border',
        badgeVariant: 'expense' as const,
        badgeLabel: 'ภาษีที่ต้องชำระเพิ่ม',
        amountColor: 'text-expense',
      };

  const standardCards = [
    {
      title: 'รายได้รวมทั้งปี',
      subtitle: 'เงินได้พึงประเมิน 40(1)-40(8)',
      amount: result.totalIncome,
      icon: Coins,
      badge: 'เงินได้ทั้งหมด',
    },
    {
      title: 'ค่าใช้จ่ายหักได้',
      subtitle: 'หักตามอัตราที่กฎหมายกำหนด',
      amount: result.totalDeductibleExpenses,
      icon: TrendingDown,
      badge: 'หักตาม ม.42 ทวิ-ม.46',
    },
    {
      title: 'ค่าลดหย่อนรวม',
      subtitle: 'ตนเอง ครอบครัว กองทุน ประกัน',
      amount: result.totalDeductions,
      icon: Receipt,
      badge: 'สิทธิลดหย่อน ม.47',
    },
    {
      title: 'เงินได้สุทธิคำนวณภาษี',
      subtitle: 'เงินได้หลังหักค่าใช้จ่ายและลดหย่อน',
      amount: result.netTaxableIncome,
      icon: Calculator,
      badge: 'ฐานคำนวณขั้นบันได',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Featured Tax Assessment Card */}
      <Card className={`p-5 sm:p-6 ${statusConfig.borderAccent}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Left primary figure */}
          <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
            <div
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-control border flex items-center justify-center shrink-0 ${statusConfig.iconWrap}`}
            >
              {isRefund || isZeroTax ? (
                <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
              ) : (
                <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6" />
              )}
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink-muted">
                  ผลการประเมินภาษีสุทธิ
                </span>
                <Badge variant={statusConfig.badgeVariant}>{statusConfig.badgeLabel}</Badge>
                <Badge variant="accent" className="tabular-nums">
                  <Percent className="w-3 h-3" />
                  อัตราภาษีแท้จริง {result.effectiveTaxRate.toFixed(2)}%
                </Badge>
              </div>

              <div className={`text-2xl sm:text-4xl font-bold tracking-tight tabular-nums ${statusConfig.amountColor}`}>
                {loading ? (
                  <span className="inline-block w-36 sm:w-48 h-9 bg-surface-subtle animate-pulse rounded-control" />
                ) : (
                  `฿${formatMoney(netAmount)}`
                )}
              </div>
            </div>
          </div>

          {/* Right breakdown cells */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-3 lg:pt-0 border-t lg:border-t-0 border-border">
            <div className="px-3.5 py-2.5 bg-surface-subtle/60 rounded-control border border-border">
              <span className="text-[11px] text-ink-muted block">ภาษีคำนวณได้</span>
              <span className="text-xs sm:text-sm font-semibold text-ink tabular-nums block mt-0.5">
                {loading ? '—' : `฿${formatMoney(result.finalTax)}`}
              </span>
            </div>
            <div className="px-3.5 py-2.5 bg-surface-subtle/60 rounded-control border border-border">
              <span className="text-[11px] text-ink-muted block">หัก ณ ที่จ่ายแล้ว</span>
              <span className="text-xs sm:text-sm font-semibold text-ink tabular-nums block mt-0.5">
                {loading ? '—' : `฿${formatMoney(result.withholdingTax)}`}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 px-3.5 py-2.5 bg-surface-subtle/60 rounded-control border border-border">
              <span className="text-[11px] text-ink-muted block">วิธีคำนวณที่ใช้</span>
              <span className="text-xs sm:text-sm font-semibold text-ink block mt-0.5">
                {result.taxMethodUsed === 'flat05'
                  ? 'เหมา 0.5% (วิธีที่ 2)'
                  : 'อัตราก้าวหน้า (วิธีที่ 1)'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* 4 Standard Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {standardCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="p-4 sm:p-5 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-ink-secondary block truncate">
                    {card.title}
                  </span>
                  <span className="text-[11px] text-ink-muted hidden sm:block truncate mt-0.5">
                    {card.subtitle}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-control bg-surface-subtle border border-border text-ink-secondary flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div>
                <p className="text-base sm:text-2xl font-bold text-ink tracking-tight tabular-nums">
                  {loading ? (
                    <span className="inline-block w-20 sm:w-28 h-6 sm:h-7 bg-surface-subtle animate-pulse rounded-badge" />
                  ) : (
                    `฿${formatMoney(card.amount)}`
                  )}
                </p>
                <span className="text-[11px] text-ink-muted block mt-1">{card.badge}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
