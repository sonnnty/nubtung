'use client';

import { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { BarChart3, TrendingDown, Layers } from 'lucide-react';
import type { MortgagePayment } from '@/lib/mortgage/types';
import { Card, formatMoney } from '@/components/ui';

interface MortgageChartsProps {
  payments: MortgagePayment[];
  loading?: boolean;
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function formatShortThaiDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const year = parseInt(parts[0], 10) + 543;
    const month = parseInt(parts[1], 10) - 1;
    const shortYear = String(year).slice(-2);
    return `${THAI_MONTHS[month] || parts[1]} ${shortYear}`;
  } catch {
    return dateStr;
  }
}

interface MonthlyAggregatedData {
  key: string;
  label: string;
  fullDate: string;
  principal: number;
  interest: number;
  fee: number;
  totalPaid: number;
  remainingBalance: number;
}

interface MortgageTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyAggregatedData }>;
}

const MortgageCustomTooltip = ({ active, payload }: MortgageTooltipProps) => {
  if (active && payload && payload.length) {
    const data: MonthlyAggregatedData = payload[0]?.payload;
    if (!data) return null;

    const principalPct = data.totalPaid > 0 ? (data.principal / data.totalPaid) * 100 : 0;
    const interestPct = data.totalPaid > 0 ? (data.interest / data.totalPaid) * 100 : 0;

    return (
      <div className="bg-surface p-3.5 rounded-card shadow-popover border border-border text-xs space-y-2 min-w-[220px]">
        <div className="border-b border-border pb-1.5 flex justify-between items-center gap-3">
          <span className="font-semibold text-ink">{data.label}</span>
          <span className="text-[11px] text-ink-muted tabular-nums">{data.fullDate}</span>
        </div>

        <div className="space-y-1 tabular-nums">
          <div className="flex justify-between items-center gap-4">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span className="w-2 h-2 rounded-full bg-income shrink-0" />
              ตัดเงินต้น ({principalPct.toFixed(0)}%)
            </span>
            <span className="font-semibold text-income">฿{formatMoney(data.principal)}</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
              ดอกเบี้ย ({interestPct.toFixed(0)}%)
            </span>
            <span className="font-semibold text-warning">฿{formatMoney(data.interest)}</span>
          </div>
          {data.fee > 0 && (
            <div className="flex justify-between items-center gap-4">
              <span className="flex items-center gap-1.5 text-ink-secondary">
                <span className="w-2 h-2 rounded-full bg-transfer shrink-0" />
                ค่าธรรมเนียม/ประกัน
              </span>
              <span className="font-semibold text-transfer">฿{formatMoney(data.fee)}</span>
            </div>
          )}
        </div>

        <div className="pt-1.5 border-t border-border flex justify-between text-ink font-semibold tabular-nums">
          <span>ยอดชำระรวม</span>
          <span>฿{formatMoney(data.totalPaid)}</span>
        </div>

        {data.remainingBalance > 0 && (
          <div className="pt-1 border-t border-dashed border-border flex justify-between text-ink-muted text-[11px] tabular-nums">
            <span>ยอดหนี้คงเหลือ</span>
            <span className="font-semibold text-ink">฿{formatMoney(data.remainingBalance)}</span>
          </div>
        )}
      </div>
    );
  }
  return null;
};

export default function MortgageCharts({ payments, loading = false }: MortgageChartsProps) {
  const [chartType, setChartType] = useState<'STACKED_BAR' | 'BALANCE_CURVE'>('STACKED_BAR');

  const chartData = useMemo(() => {
    if (!payments || payments.length === 0) return [];

    const sorted = [...payments].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    const map = new Map<string, MonthlyAggregatedData>();
    const accountLatestBalances = new Map<string, number>();

    for (const p of sorted) {
      const monthKey = p.paymentDate.slice(0, 7);
      const balance = Number(p.remainingBalance) || 0;
      if (balance > 0) {
        accountLatestBalances.set(p.accountId, balance);
      }

      const totalBalanceAtThisPoint = Array.from(accountLatestBalances.values()).reduce(
        (sum, b) => sum + b,
        0
      );

      const existing = map.get(monthKey);
      if (existing) {
        existing.principal += Number(p.principal) || 0;
        existing.interest += Number(p.interest) || 0;
        existing.fee += Number(p.fee) || 0;
        existing.totalPaid += Number(p.totalPaid) || 0;
        existing.remainingBalance = totalBalanceAtThisPoint;
        existing.fullDate = p.paymentDate;
      } else {
        map.set(monthKey, {
          key: monthKey,
          label: formatShortThaiDate(p.paymentDate),
          fullDate: p.paymentDate,
          principal: Number(p.principal) || 0,
          interest: Number(p.interest) || 0,
          fee: Number(p.fee) || 0,
          totalPaid: Number(p.totalPaid) || 0,
          remainingBalance: totalBalanceAtThisPoint,
        });
      }
    }

    return Array.from(map.values()).map((item) => ({
      ...item,
      principal: Math.round(item.principal * 100) / 100,
      interest: Math.round(item.interest * 100) / 100,
      fee: Math.round(item.fee * 100) / 100,
      totalPaid: Math.round(item.totalPaid * 100) / 100,
      remainingBalance: Math.round(item.remainingBalance * 100) / 100,
    }));
  }, [payments]);

  if (loading) {
    return (
      <Card className="p-5 sm:p-6 h-[420px] flex items-center justify-center">
        <div className="w-full h-full bg-surface-subtle animate-pulse rounded-control" />
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="p-8 h-[360px] flex flex-col items-center justify-center text-ink-muted text-xs text-center">
        <Layers className="w-8 h-8 mb-2.5 opacity-40" />
        <span className="font-semibold text-ink text-sm">ยังไม่มีข้อมูลการผ่อนชำระ</span>
        <span className="mt-1">
          กด &ldquo;ซิงค์จากอีเมล ธอส.&rdquo; หรือบันทึกรายการด้วยตนเองเพื่อเริ่มต้น
        </span>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6 flex flex-col justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-ink tracking-tight">
            {chartType === 'STACKED_BAR'
              ? 'สัดส่วนการชำระรายเดือน'
              : 'แนวโน้มการลดยอดหนี้คงเหลือ'}
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            {chartType === 'STACKED_BAR'
              ? 'แยกสัดส่วนเงินต้น ดอกเบี้ย และค่าประกัน/ค่าธรรมเนียมในแต่ละเดือน'
              : 'แสดงการลดลงของภาระหนี้คงเหลือตามช่วงเวลา'}
          </p>
        </div>

        {/* Toggle Chart Type */}
        <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-control border border-border self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setChartType('STACKED_BAR')}
            aria-pressed={chartType === 'STACKED_BAR'}
            className={`min-h-8 flex items-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors cursor-pointer ${
              chartType === 'STACKED_BAR'
                ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                : 'text-ink-secondary hover:text-ink border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>สัดส่วนงวด</span>
          </button>
          <button
            type="button"
            onClick={() => setChartType('BALANCE_CURVE')}
            aria-pressed={chartType === 'BALANCE_CURVE'}
            className={`min-h-8 flex items-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors cursor-pointer ${
              chartType === 'BALANCE_CURVE'
                ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                : 'text-ink-secondary hover:text-ink border border-transparent'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>ยอดหนี้ลดลง</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[320px] sm:h-[360px] pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'STACKED_BAR' ? (
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
              />
              <Tooltip content={<MortgageCustomTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}
                formatter={(value) => {
                  if (value === 'principal') return 'เงินต้น';
                  if (value === 'interest') return 'ดอกเบี้ย';
                  if (value === 'fee') return 'ประกัน/ธรรมเนียม';
                  return value;
                }}
              />
              <Bar dataKey="principal" stackId="a" fill="var(--income)" radius={[0, 0, 0, 0]} maxBarSize={36} />
              <Bar dataKey="interest" stackId="a" fill="var(--warning)" radius={[0, 0, 0, 0]} maxBarSize={36} />
              <Bar dataKey="fee" stackId="a" fill="var(--transfer)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          ) : (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                tickFormatter={(v: number) =>
                  v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`
                }
              />
              <Tooltip content={<MortgageCustomTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}
                formatter={() => 'ยอดหนี้คงเหลือ'}
              />
              <Area
                type="monotone"
                dataKey="remainingBalance"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="var(--chart-1)"
                fillOpacity={0.1}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
