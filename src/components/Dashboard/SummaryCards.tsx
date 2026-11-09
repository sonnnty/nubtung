'use client';

import { ArrowDownRight, ArrowUpRight, Repeat, Wallet, Building2 } from 'lucide-react';
import { DashboardSummary } from '@/types';

interface SummaryCardsProps {
  summary: DashboardSummary | null;
  overallSummary?: DashboardSummary | null;
  loading: boolean;
  kplusBalance?: number;
  makeBalance?: number;
  accountBalances?: Record<string, number>;
  totalCashInAccounts?: number;
}

export default function SummaryCards({
  summary,
  overallSummary,
  loading,
  kplusBalance,
  makeBalance,
  accountBalances,
  totalCashInAccounts,
}: SummaryCardsProps) {
  const cards = [
    {
      title: 'รายรับในช่วงเวลา',
      amount: summary?.totalIncome || 0,
      icon: ArrowDownRight,
      color: 'emerald',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200/60 dark:border-emerald-800/40',
      badge: 'เงินเข้า',
    },
    {
      title: 'รายจ่ายในช่วงเวลา',
      amount: summary?.totalExpense || 0,
      icon: ArrowUpRight,
      color: 'rose',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      text: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-200/60 dark:border-rose-800/40',
      badge: 'เงินออก',
    },
    {
      title: 'กระแสเงินสดสุทธิ',
      amount: summary?.netBalance || 0,
      icon: Wallet,
      color: 'sky',
      bg: 'bg-sky-50 dark:bg-sky-950/40',
      text: 'text-sky-600 dark:text-sky-400',
      border: 'border-sky-200/60 dark:border-sky-800/40',
      badge: 'รายรับ - รายจ่าย',
    },
    {
      title: 'โอนระหว่างบัญชี',
      amount: summary?.transferTotal || 0,
      icon: Repeat,
      color: 'amber',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200/60 dark:border-amber-800/40',
      badge: 'ไม่นับเป็นรายจ่าย',
    },
  ];

  const resolvedAccountBalances =
    accountBalances ||
    overallSummary?.accountBalances ||
    summary?.accountBalances || {
      'K PLUS': kplusBalance ?? 43253.07,
      'Make by KBank': makeBalance ?? 3672.29,
      'เป๋าตัง': 195.44,
      'เงินสด': 0,
    };

  const resolvedTotalCash =
    totalCashInAccounts ??
    overallSummary?.totalCashInAccounts ??
    summary?.totalCashInAccounts ??
    Object.values(resolvedAccountBalances).reduce((sum, val) => sum + val, 0);

  // Accounts whose balance starts from an imported e-statement's closing balance, or a KBank Live card
  const balanceAsOf = overallSummary?.accountBalanceAsOf || summary?.accountBalanceAsOf || {};
  const balanceGaps = overallSummary?.accountBalanceGaps || summary?.accountBalanceGaps || {};
  const cardTimes = overallSummary?.accountCardTimes || summary?.accountCardTimes || {};

  const formatMoney = (amount: number) =>
    amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const renderCardStatus = (account: string) => {
    const cardTime = cardTimes[account];
    const gap = balanceGaps[account];

    if (!cardTime || gap === null || gap === undefined) {
      const periodEnd = balanceAsOf[account];
      const [, m, d] = periodEnd ? periodEnd.split('-') : [];
      return (
        <div className="mt-0.5 space-y-0.5">
          {periodEnd && (
            <span
              className="text-[8px] sm:text-[9px] text-emerald-100/80 font-medium block leading-tight"
              title={`ยอดตาม statement ${d}/${m} + รายการหลังจากนั้น`}
            >
              ตาม statement {d}/{m} + รายการใหม่
            </span>
          )}
          <span
            className="text-[8px] sm:text-[9px] text-emerald-100/75 font-medium block leading-tight"
            title="ยังไม่มีการ์ด KBank Live จากแชต LINE"
          >
            ส่วนต่าง —
          </span>
        </div>
      );
    }

    const [datePart = '', timePart = ''] = cardTime.split(' ');
    const [, m, d] = datePart.split('-');
    const whenLabel = d && m ? `${d}/${m} ${timePart}` : cardTime;

    return (
      <div className="mt-0.5 space-y-0.5">
        <span
          className="text-[8px] sm:text-[9px] text-emerald-100/85 font-medium block leading-tight"
          title={`ยอดจากการ์ด KBank Live ในแชต LINE เมื่อ ${whenLabel} น.`}
        >
          จากแชต {whenLabel} น.
        </span>
        {gap === 0 ? (
          <span
            className="text-[8px] sm:text-[9px] text-emerald-100/90 font-medium block leading-tight"
            title="ยอดในสมุดบัญชีตรงกับยอดในการ์ดแชต LINE (ส่วนต่าง ฿0.00)"
          >
            ข้อมูลในระบบตรงกับธนาคาร (฿0.00)
          </span>
        ) : gap > 0 ? (
          <span
            className="inline-block px-1.5 py-0.5 rounded-md bg-amber-300/25 dark:bg-amber-400/20 border border-amber-200/40 text-amber-50 text-[8px] sm:text-[9px] font-semibold leading-tight"
            title={`ยอดในสมุดบัญชีมากกว่าแชต +฿${formatMoney(gap)} (อาจมีรายจ่ายตกหล่น)`}
          >
            ข้อมูลในระบบมากกว่าธนาคาร +฿{formatMoney(gap)}
          </span>
        ) : (
          <span
            className="inline-block px-1.5 py-0.5 rounded-md bg-amber-300/25 dark:bg-amber-400/20 border border-amber-200/40 text-amber-50 text-[8px] sm:text-[9px] font-semibold leading-tight"
            title={`ยอดในสมุดบัญชีน้อยกว่าแชต -฿${formatMoney(Math.abs(gap))} (อาจมีรายจ่ายซ้ำหรือรายรับตกหล่น)`}
          >
            ข้อมูลในระบบน้อยกว่าธนาคาร -฿{formatMoney(Math.abs(gap))}
          </span>
        )}
      </div>
    );
  };

  const kplusBal = resolvedAccountBalances['K PLUS'] ?? 43253.07;
  const makeBal = resolvedAccountBalances['Make by KBank'] ?? 3672.29;
  const paotangBal = resolvedAccountBalances['เป๋าตัง'] ?? 195.44;
  const cashBal = resolvedAccountBalances['เงินสด'] ?? 0;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Real Account Balances Header Bar */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 rounded-3xl text-white shadow-lg shadow-emerald-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white shrink-0">
            <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <span className="text-[10px] sm:text-xs uppercase tracking-wider text-emerald-100 font-semibold block">
              เงินในบัญชีจริงและเงินสดทั้งหมด (Total Cash)
            </span>
            <span className="text-xl sm:text-3xl font-extrabold tracking-tight">
              ฿{formatMoney(resolvedTotalCash)}
            </span>
          </div>
        </div>

        {/* Dynamic Breakdown by Bank / Account (2x2 on mobile, flex row on desktop) */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-stretch gap-1.5 sm:gap-2 pt-1 sm:pt-0 w-full sm:w-auto">
          <div className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white/15 backdrop-blur-md rounded-2xl border border-white/20">
            <span className="text-[9px] sm:text-[10px] text-emerald-100 font-medium block">🔵 K PLUS</span>
            <span className="text-xs sm:text-sm font-bold block">฿{formatMoney(kplusBal)}</span>
            {renderCardStatus('K PLUS')}
          </div>
          <div className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white/15 backdrop-blur-md rounded-2xl border border-white/20">
            <span className="text-[9px] sm:text-[10px] text-emerald-100 font-medium block">🟡 Make</span>
            <span className="text-xs sm:text-sm font-bold block">฿{formatMoney(makeBal)}</span>
            {renderCardStatus('Make by KBank')}
          </div>
          <div className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white/15 backdrop-blur-md rounded-2xl border border-white/20">
            <span className="text-[9px] sm:text-[10px] text-emerald-100 font-medium block">📲 เป๋าตัง</span>
            <span className="text-xs sm:text-sm font-bold block">฿{formatMoney(paotangBal)}</span>
          </div>
          <div className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white/15 backdrop-blur-md rounded-2xl border border-white/20">
            <span className="text-[9px] sm:text-[10px] text-emerald-100 font-medium block">💵 เงินสด</span>
            <span className="text-xs sm:text-sm font-bold block">฿{formatMoney(cashBal)}</span>
          </div>
        </div>
      </div>

      {/* 4 Period Metric Cards (2x2 on mobile, 4 in a row on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className={`p-3.5 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 border ${card.border} shadow-xs flex flex-col justify-between transition-all hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <span className="text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 line-clamp-1">{card.title}</span>
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl ${card.bg} ${card.text} flex items-center justify-center shrink-0`}>
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline gap-1 mb-0.5 sm:mb-1">
                  <span className={`text-base sm:text-2xl font-extrabold tracking-tight ${card.text}`}>
                    {loading ? (
                      <span className="inline-block w-16 sm:w-24 h-5 sm:h-7 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                    ) : (
                      `฿${card.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    )}
                  </span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 font-medium">{card.badge}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
