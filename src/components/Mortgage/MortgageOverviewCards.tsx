'use client';

import { Home, TrendingDown, Receipt, Coins } from 'lucide-react';
import type { MortgageSummary } from '@/lib/mortgage/types';
import { Badge, Card } from '@/components/ui';

interface MortgageOverviewCardsProps {
  summary: MortgageSummary | null;
  selectedAccountId: string;
  loading?: boolean;
}

const formatMoney = (amount: number) =>
  amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MortgageOverviewCards({
  summary,
  selectedAccountId,
  loading = false,
}: MortgageOverviewCardsProps) {
  if (loading || !summary) {
    return (
      <div className="space-y-4">
        <div className="h-40 rounded-card bg-surface border border-border animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-card bg-surface border border-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isAll = selectedAccountId === 'ALL';
  const currentAccount = isAll
    ? null
    : summary.accounts.find((a) => a.id === selectedAccountId) || summary.accounts[0];

  const loanAmount = currentAccount ? currentAccount.loanAmount : summary.totalLoanAmount;
  const remainingBalance = currentAccount ? currentAccount.remainingBalance : summary.totalRemainingBalance;
  const principalPaid = currentAccount ? currentAccount.principalPaid : summary.totalPrincipalPaid;
  const interestPaid = currentAccount ? currentAccount.interestPaid : summary.totalInterestPaid;
  const feePaid = currentAccount ? currentAccount.feePaid : summary.totalFeePaid;
  const progressPercent = currentAccount ? currentAccount.progressPercent : summary.progressPercent;

  const totalPaidOverall = principalPaid + interestPaid + feePaid;

  const cards = [
    {
      title: 'ยอดหนี้คงเหลือ',
      subtitle: `จากวงเงินกู้ ฿${formatMoney(loanAmount)}`,
      amount: remainingBalance,
      icon: Home,
      badgeVariant: 'expense' as const,
      iconWrap: 'bg-expense-soft text-expense border-expense-border',
      badge: 'คงค้างชำระ',
    },
    {
      title: 'เงินต้นที่ชำระแล้ว',
      subtitle: `ตัดเงินต้นไปแล้ว ${progressPercent.toFixed(1)}%`,
      amount: principalPaid,
      icon: TrendingDown,
      badgeVariant: 'income' as const,
      iconWrap: 'bg-income-soft text-income border-income-border',
      badge: `${progressPercent.toFixed(1)}% สำเร็จ`,
    },
    {
      title: 'ดอกเบี้ยสะสมที่จ่ายไป',
      subtitle: 'ดอกเบี้ยจ่ายทั้งหมดสะสม',
      amount: interestPaid,
      icon: Coins,
      badgeVariant: 'warning' as const,
      iconWrap: 'bg-warning-soft text-warning border-warning-border',
      badge: 'ดอกเบี้ยจ่าย',
    },
    {
      title: 'ค่าธรรมเนียม / ประกันสะสม',
      subtitle: 'ค่าเบี้ยประกันและธรรมเนียม',
      amount: feePaid,
      icon: Receipt,
      badgeVariant: 'transfer' as const,
      iconWrap: 'bg-transfer-soft text-transfer border-transfer-border',
      badge: 'ค่าใช้จ่ายแฝง',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Loan Portfolio Summary Card */}
      <Card className="p-5 sm:p-6 border-l-4 border-l-accent space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent">
                {isAll ? 'ภาพรวมสัญญาเงินกู้ทั้งหมด' : currentAccount?.name}
              </Badge>
              <span className="text-xs text-ink-muted font-mono">
                {isAll ? '2 บัญชีคู่สัญญา' : `เลขที่ ${currentAccount?.accountNumber}`}
              </span>
            </div>

            <div>
              <p className="text-xs text-ink-muted font-medium">ยอดหนี้คงเหลือรวมสุทธิ</p>
              <div className="flex flex-wrap items-baseline gap-2 mt-1 tabular-nums">
                <span className="text-2xl sm:text-4xl font-bold text-ink tracking-tight">
                  ฿{formatMoney(remainingBalance)}
                </span>
                <span className="text-xs sm:text-sm text-ink-muted">
                  / ฿{loanAmount.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          </div>

          {/* Progress Box */}
          <div className="min-w-[240px] max-w-sm w-full bg-surface-subtle/60 p-4 rounded-control border border-border space-y-2.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-ink-secondary">ความคืบหน้าการปลดหนี้</span>
              <span className="text-accent-text font-semibold tabular-nums">
                {progressPercent.toFixed(2)}%
              </span>
            </div>

            <div className="w-full bg-surface border border-border rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-accent h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-ink-muted tabular-nums pt-0.5">
              <span>
                เงินต้นแล้ว ฿{principalPaid.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
              </span>
              <span>
                รวมจ่าย ฿{totalPaidOverall.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>

        {/* Account Breakdown Rows when in ALL view */}
        {isAll && summary.accounts.length > 0 && (
          <div className="pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {summary.accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between gap-2 bg-surface-subtle/40 px-3.5 py-2.5 rounded-control border border-border"
              >
                <div className="min-w-0">
                  <span className="font-medium text-ink block truncate">{acc.name}</span>
                  <span className="text-[11px] font-mono text-ink-muted">{acc.accountNumber}</span>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <span className="font-semibold text-ink block">
                    ฿{acc.remainingBalance.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-[11px] text-income font-medium">
                    ชำระแล้ว {acc.progressPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 4 Detail KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="p-4 sm:p-5 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`w-8 h-8 rounded-control border flex items-center justify-center shrink-0 ${card.iconWrap}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <Badge variant={card.badgeVariant} className="tabular-nums">
                  {card.badge}
                </Badge>
              </div>

              <div>
                <p className="text-xs font-medium text-ink-secondary">{card.title}</p>
                <p className="text-xl sm:text-2xl font-bold text-ink mt-1 tracking-tight tabular-nums">
                  ฿{formatMoney(card.amount)}
                </p>
                <p className="text-[11px] text-ink-muted mt-1 truncate">{card.subtitle}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
