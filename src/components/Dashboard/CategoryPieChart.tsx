'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { Card, formatMoney } from '@/components/ui';

interface CategoryPieChartProps {
  categoryBreakdown: Record<string, number>;
  totalExpense: number;
  loading?: boolean;
}

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

interface CategoryDatum {
  name: string;
  value: number;
  fill: string;
}

interface CategoryTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CategoryDatum; color?: string }>;
  totalExpense: number;
}

const CategoryTooltip = ({ active, payload, totalExpense }: CategoryTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const fill = data.fill || payload[0].color || 'var(--chart-1)';
    const percent = totalExpense > 0 ? ((data.value / totalExpense) * 100).toFixed(1) : '0.0';

    return (
      <div className="bg-surface p-3.5 rounded-card shadow-popover border border-border text-xs space-y-2 min-w-[200px] pointer-events-none select-none">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: fill }}
          />
          <span className="font-semibold text-ink truncate">{data.name}</span>
        </div>
        <div className="flex justify-between items-center gap-4 tabular-nums">
          <span className="text-ink-muted">ยอดใช้จ่าย</span>
          <span className="font-semibold text-ink">฿{formatMoney(Number(data.value))}</span>
        </div>
        <div className="flex justify-between items-center gap-4 tabular-nums">
          <span className="text-ink-muted">สัดส่วน</span>
          <span className="font-semibold text-accent-text">{percent}% ของทั้งหมด</span>
        </div>
      </div>
    );
  }
  return null;
};

export default function CategoryPieChart({
  categoryBreakdown,
  totalExpense,
  loading,
}: CategoryPieChartProps) {
  if (loading) {
    return (
      <Card className="p-5 sm:p-6 h-full min-h-[380px] flex items-center justify-center">
        <div className="w-full h-full bg-surface-subtle animate-pulse rounded-control" />
      </Card>
    );
  }

  const entries = Object.entries(categoryBreakdown || {}).sort(([, a], [, b]) => b - a);
  const data: CategoryDatum[] = entries.map(([name, value], index) => ({
    name,
    value,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));

  if (data.length === 0 || totalExpense <= 0) {
    return (
      <Card className="p-5 sm:p-6 h-full min-h-[380px] flex flex-col items-center justify-center text-ink-muted text-xs">
        <PieIcon className="w-8 h-8 mb-2 opacity-40" />
        <span>ไม่มีข้อมูลค่าใช้จ่ายในช่วงเวลานี้</span>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6 h-full flex flex-col justify-between">
      <div>
        <div className="mb-3">
          <h2 className="text-sm sm:text-base font-semibold text-ink tracking-tight">
            สัดส่วนค่าใช้จ่ายตามหมวดหมู่
          </h2>
          <p className="text-xs text-ink-muted tabular-nums mt-0.5">
            ยอดรวม ฿{formatMoney(totalExpense)}
          </p>
        </div>

        {/* Donut Chart */}
        <div className="h-44 w-full relative flex items-center justify-center">
          <div className="absolute z-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] text-ink-muted font-medium">ค่าใช้จ่าย</span>
            <span className="text-xs font-semibold text-ink tabular-nums">
              {data.length} หมวดหมู่
            </span>
          </div>

          <ResponsiveContainer width="100%" height="100%" className="relative z-10">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={2}
                stroke="var(--bg-surface)"
                strokeWidth={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                content={<CategoryTooltip totalExpense={totalExpense} />}
                wrapperStyle={{ zIndex: 1000, pointerEvents: 'none' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Legend List */}
        <div className="divide-y divide-border mt-3 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
          {entries.map(([category, amount], idx) => {
            const pct = Math.round((amount / totalExpense) * 100);
            const color = CHART_COLORS[idx % CHART_COLORS.length];
            return (
              <div key={category} className="flex items-center justify-between gap-3 text-xs py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-ink-secondary font-medium truncate">{category}</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                  <span className="font-semibold text-ink">฿{formatMoney(amount)}</span>
                  <span className="text-[11px] text-ink-muted w-9 text-right">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
