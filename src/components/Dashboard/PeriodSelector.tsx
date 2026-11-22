'use client';

import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  RotateCcw,
  Briefcase,
  CalendarDays,
} from 'lucide-react';
import { Button, Card } from '@/components/ui';

export type PeriodMode = 'ALL' | 'YEAR' | 'MONTH' | 'WEEK' | 'DAY';

interface PeriodSelectorProps {
  mode: PeriodMode;
  onModeChange: (mode: PeriodMode) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  useSalaryCycle?: boolean;
  onToggleSalaryCycle?: (enabled: boolean) => void;
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_FULL_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export function getSalaryCycleRange(
  date: Date,
  payDay = 26
): { startDate: Date; endDate: Date; label: string } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  let startYear = y;
  let startMonth = m;

  if (d < payDay) {
    startMonth = m - 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear = y - 1;
    }
  }

  const startDate = new Date(startYear, startMonth, payDay, 0, 0, 0, 0);

  let endMonth = startMonth + 1;
  let endYear = startYear;
  if (endMonth > 11) {
    endMonth = 0;
    endYear = startYear + 1;
  }

  const endDate = new Date(endYear, endMonth, payDay - 1, 23, 59, 59, 999);

  const startMonthStr = THAI_MONTHS[startDate.getMonth()];
  const endMonthStr = THAI_MONTHS[endDate.getMonth()];
  const buddhistYear = endDate.getFullYear() + 543;

  const label = `26 ${startMonthStr} - 25 ${endMonthStr} ${buddhistYear}`;

  return { startDate, endDate, label };
}

export default function PeriodSelector({
  mode,
  onModeChange,
  selectedDate,
  onDateChange,
  useSalaryCycle = true,
  onToggleSalaryCycle,
}: PeriodSelectorProps) {
  const currentYear = selectedDate.getFullYear();
  const currentMonth = selectedDate.getMonth();
  const currentDate = selectedDate.getDate();

  const handlePrev = () => {
    const next = new Date(selectedDate);
    if (mode === 'YEAR') {
      next.setFullYear(currentYear - 1);
    } else if (mode === 'MONTH') {
      next.setMonth(currentMonth - 1);
    } else if (mode === 'WEEK') {
      next.setDate(currentDate - 7);
    } else if (mode === 'DAY') {
      next.setDate(currentDate - 1);
    }
    onDateChange(next);
  };

  const handleNext = () => {
    const next = new Date(selectedDate);
    if (mode === 'YEAR') {
      next.setFullYear(currentYear + 1);
    } else if (mode === 'MONTH') {
      next.setMonth(currentMonth + 1);
    } else if (mode === 'WEEK') {
      next.setDate(currentDate + 7);
    } else if (mode === 'DAY') {
      next.setDate(currentDate + 1);
    }
    onDateChange(next);
  };

  const handleResetToToday = () => {
    onDateChange(new Date());
  };

  const getPeriodLabel = () => {
    const buddhistYear = currentYear + 543;
    if (mode === 'ALL') {
      return 'ข้อมูลทั้งหมด';
    }
    if (mode === 'YEAR') {
      return `ปี พ.ศ. ${buddhistYear}`;
    }
    if (mode === 'MONTH') {
      if (useSalaryCycle) {
        return getSalaryCycleRange(selectedDate, 26).label;
      }
      return `${THAI_FULL_MONTHS[currentMonth]} ${buddhistYear}`;
    }
    if (mode === 'WEEK') {
      const startOfWeek = new Date(selectedDate);
      const day = startOfWeek.getDay() || 7;
      startOfWeek.setDate(startOfWeek.getDate() - day + 1);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const startMonth = THAI_MONTHS[startOfWeek.getMonth()];
      const endMonth = THAI_MONTHS[endOfWeek.getMonth()];

      return `${startOfWeek.getDate()} ${startMonth} - ${endOfWeek.getDate()} ${endMonth}`;
    }
    if (mode === 'DAY') {
      return `${currentDate} ${THAI_FULL_MONTHS[currentMonth]} ${buddhistYear}`;
    }
    return '';
  };

  const modeButtons: { id: PeriodMode; label: string }[] = [
    { id: 'MONTH', label: 'รายเดือน' },
    { id: 'YEAR', label: 'รายปี' },
    { id: 'WEEK', label: 'สัปดาห์' },
    { id: 'DAY', label: 'รายวัน' },
    { id: 'ALL', label: 'ทั้งหมด' },
  ];

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* Mode Switcher Tabs */}
        <div
          role="tablist"
          aria-label="รูปแบบช่วงเวลา"
          className="flex items-center gap-1 bg-surface-subtle p-1 rounded-control border border-border overflow-x-auto no-scrollbar"
        >
          {modeButtons.map((btn) => {
            const active = mode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onModeChange(btn.id)}
                className={`min-h-9 sm:min-h-8 px-3 py-1.5 rounded-badge text-xs font-medium whitespace-nowrap transition-colors duration-150 flex-1 sm:flex-none text-center cursor-pointer ${
                  active
                    ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                    : 'text-ink-secondary hover:text-ink border border-transparent'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>

        {/* Date Navigator */}
        {mode !== 'ALL' ? (
          <div className="flex items-center justify-between gap-1.5">
            <Button
              variant="secondary"
              size="icon"
              onClick={handlePrev}
              title="ย้อนกลับ"
              aria-label="ช่วงเวลาก่อนหน้า"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="flex-1 sm:flex-none min-h-10 sm:min-h-9 flex items-center justify-center gap-2 px-3.5 py-1.5 bg-surface-subtle rounded-control border border-border text-xs font-semibold text-ink tabular-nums text-center min-w-0">
              <Calendar className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              <span className="truncate">{getPeriodLabel()}</span>
            </div>

            <Button
              variant="secondary"
              size="icon"
              onClick={handleNext}
              title="ถัดไป"
              aria-label="ช่วงเวลาถัดไป"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            <Button
              variant="secondary"
              size="icon"
              onClick={handleResetToToday}
              title="กลับมาปัจจุบัน"
              aria-label="กลับมาช่วงเวลาปัจจุบัน"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="text-xs text-ink-muted px-2 py-1.5 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>แสดงรายการทั้งหมดตั้งแต่เริ่มบันทึก</span>
          </div>
        )}
      </div>

      {/* Salary Cycle Switcher Toggle */}
      {mode === 'MONTH' && onToggleSalaryCycle && (
        <div className="pt-2.5 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="text-ink-muted font-medium">รอบการตัดเดือน</span>

          <div className="grid grid-cols-2 gap-1 bg-surface-subtle p-1 rounded-control border border-border">
            <button
              type="button"
              onClick={() => onToggleSalaryCycle(true)}
              aria-pressed={useSalaryCycle}
              className={`min-h-9 sm:min-h-8 inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors duration-150 cursor-pointer ${
                useSalaryCycle
                  ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                  : 'text-ink-secondary hover:text-ink border border-transparent'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 shrink-0" />
              <span>เงินเดือน (26-25)</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleSalaryCycle(false)}
              aria-pressed={!useSalaryCycle}
              className={`min-h-9 sm:min-h-8 inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-badge text-xs font-medium transition-colors duration-150 cursor-pointer ${
                !useSalaryCycle
                  ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                  : 'text-ink-secondary hover:text-ink border border-transparent'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>ปฏิทิน (1-สิ้นเดือน)</span>
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
