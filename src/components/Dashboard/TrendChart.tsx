'use client';

import { useState } from 'react';
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
import { BarChart3, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui';

export interface ChartDataPoint {
  label: string;
  income: number;
  expense: number;
  net: number;
}

interface TrendChartProps {
  data: ChartDataPoint[];
  loading?: boolean;
}

interface TrendTooltipPayloadItem {
  dataKey?: string;
  value?: number;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: TrendTooltipPayloadItem[];
  label?: string;
}

const formatMoney = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CustomTooltip = ({ active, payload, label }: TrendTooltipProps) => {
  if (active && payload && payload.length) {
    const income = Number(payload.find((p) => p.dataKey === 'income')?.value || 0);
    const expense = Number(payload.find((p) => p.dataKey === 'expense')?.value || 0);
    const net = income - expense;

    return (
      <div className="bg-surface p-3.5 rounded-card shadow-popover border border-border text-xs space-y-2 min-w-[200px]">
        <p className="font-semibold text-ink border-b border-border pb-1.5">{label}</p>
        <div className="space-y-1 tabular-nums">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span className="w-2 h-2 rounded-full bg-income shrink-0" />
              รายรับ
            </span>
            <span className="font-semibold text-income">฿{formatMoney(income)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span className="w-2 h-2 rounded-full bg-expense shrink-0" />
              รายจ่าย
            </span>
            <span className="font-semibold text-expense">฿{formatMoney(expense)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-border font-semibold tabular-nums">
          <span className="text-ink-secondary">สุทธิ</span>
          <span className={net >= 0 ? 'text-income' : 'text-expense'}>
            {net > 0 ? '+' : net < 0 ? '-' : ''}฿{formatMoney(Math.abs(net))}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function TrendChart({ data, loading }: TrendChartProps) {
  const [chartType, setChartType] = useState<'BAR' | 'AREA'>('AREA');

  if (loading) {
    return (
      <Card className="p-5 sm:p-6 h-full min-h-[380px] flex items-center justify-center">
        <div className="w-full h-full bg-surface-subtle animate-pulse rounded-control" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="p-5 sm:p-6 h-full min-h-[380px] flex flex-col items-center justify-center text-ink-muted text-xs">
        <BarChart3 className="w-8 h-8 mb-2 opacity-40" />
        <span>ไม่มีข้อมูลธุรกรรมในช่วงเวลานี้</span>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6 h-full flex flex-col justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm sm:text-base font-semibold text-ink tracking-tight">
            แนวโน้มรายรับ - รายจ่าย
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">
            เปรียบเทียบกระแสเงินเข้าและออกตามช่วงเวลาที่เลือก
          </p>
        </div>

        {/* Toggle Chart Type */}
        <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-control border border-border self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setChartType('BAR')}
            aria-pressed={chartType === 'BAR'}
            className={`min-h-8 flex items-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors duration-150 cursor-pointer ${
              chartType === 'BAR'
                ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                : 'text-ink-secondary hover:text-ink border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>กราฟแท่ง</span>
          </button>
          <button
            type="button"
            onClick={() => setChartType('AREA')}
            aria-pressed={chartType === 'AREA'}
            className={`min-h-8 flex items-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors duration-150 cursor-pointer ${
              chartType === 'AREA'
                ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                : 'text-ink-secondary hover:text-ink border border-transparent'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>กราฟเส้น</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="flex-1 w-full min-h-[300px] pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'BAR' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}
                formatter={(value) => (value === 'income' ? 'รายรับ' : 'รายจ่าย')}
              />
              <Bar dataKey="income" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="expense" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}
                formatter={(value) => (value === 'income' ? 'รายรับ' : 'รายจ่าย')}
              />
              <Area
                type="monotone"
                dataKey="income"
                stroke="var(--income)"
                strokeWidth={2}
                fill="var(--income)"
                fillOpacity={0.1}
              />
              <Area
                type="monotone"
                dataKey="expense"
                stroke="var(--expense)"
                strokeWidth={2}
                fill="var(--expense)"
                fillOpacity={0.1}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
