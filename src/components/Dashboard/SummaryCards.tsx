'use client';

import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Wallet,
  Building2,
  Landmark,
  Smartphone,
  Banknote,
} from 'lucide-react';
import { DashboardSummary } from '@/types';
import { describeBalanceAdjustment } from '@/lib/balance/balance-adjustment';
import { readJson } from '@/lib/utils/http';
import { Alert, Badge, Button, Card, ConfirmDialog, formatMoney } from '@/components/ui';

interface SummaryCardsProps {
  summary: DashboardSummary | null;
  overallSummary?: DashboardSummary | null;
  loading: boolean;
  kplusBalance?: number;
  makeBalance?: number;
  accountBalances?: Record<string, number>;
  totalCashInAccounts?: number;
  /** Called after a balance adjustment row was added, to reload the dashboard data */
  onBalanceAdjusted?: () => void | Promise<void>;
}

export default function SummaryCards({
  summary,
  overallSummary,
  loading,
  kplusBalance,
  makeBalance,
  accountBalances,
  totalCashInAccounts,
  onBalanceAdjusted,
}: SummaryCardsProps) {
  const [adjustingAccount, setAdjustingAccount] = useState<string | null>(null);
  const [pendingAdjust, setPendingAdjust] = useState<{ account: string; gap: number } | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const netBalance = summary?.netBalance || 0;

  const metricCards = [
    {
      title: 'รายรับในช่วงเวลา',
      amount: summary?.totalIncome || 0,
      prefix: '',
      icon: ArrowDownLeft,
      iconBg: 'bg-income-soft text-income border-income-border',
      amountClass: 'text-income',
      caption: 'เงินเข้าสุทธิ',
    },
    {
      title: 'รายจ่ายในช่วงเวลา',
      amount: summary?.totalExpense || 0,
      prefix: '',
      icon: ArrowUpRight,
      iconBg: 'bg-expense-soft text-expense border-expense-border',
      amountClass: 'text-expense',
      caption: 'เงินออกสุทธิ',
    },
    {
      title: 'กระแสเงินสดสุทธิ',
      amount: Math.abs(netBalance),
      prefix: netBalance > 0 ? '+' : netBalance < 0 ? '-' : '',
      icon: Wallet,
      iconBg: 'bg-accent-soft text-accent-text border-accent-border',
      amountClass: netBalance > 0 ? 'text-income' : netBalance < 0 ? 'text-expense' : 'text-ink',
      caption: 'รายรับหักรายจ่าย',
    },
    {
      title: 'โอนระหว่างบัญชี',
      amount: summary?.transferTotal || 0,
      prefix: '',
      icon: ArrowLeftRight,
      iconBg: 'bg-transfer-soft text-transfer border-transfer-border',
      amountClass: 'text-transfer',
      caption: 'ไม่นับเป็นรายจ่าย',
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

  // Adds one row that brings the ledger to the bank's balance. The server works the amount out again
  // from the database; this only names the account.
  const handleConfirmAdjust = async () => {
    if (!pendingAdjust) return;
    const { account } = pendingAdjust;
    setAdjustingAccount(account);
    setAdjustError(null);
    try {
      const res = await fetch('/api/transactions/balance-adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'ปรับยอดไม่สำเร็จ');
      setPendingAdjust(null);
      await onBalanceAdjusted?.();
    } catch (err: unknown) {
      setAdjustError(`ปรับยอดไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
      setPendingAdjust(null);
    } finally {
      setAdjustingAccount(null);
    }
  };

  const renderCardStatus = (account: string) => {
    const cardTime = cardTimes[account];
    const gap = balanceGaps[account];

    if (!cardTime || gap === null || gap === undefined) {
      const periodEnd = balanceAsOf[account];
      const [, m, d] = periodEnd ? periodEnd.split('-') : [];
      return (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          {periodEnd && (
            <p
              className="text-[11px] text-ink-muted leading-snug"
              title={`ยอดตาม statement ${d}/${m} + รายการหลังจากนั้น`}
            >
              ตาม statement {d}/{m} + รายการใหม่
            </p>
          )}
          <p
            className="text-[11px] text-ink-muted leading-snug"
            title="ยังไม่มีการ์ด KBank Live จากแชต LINE"
          >
            ส่วนต่าง —
          </p>
        </div>
      );
    }

    const [datePart = '', timePart = ''] = cardTime.split(' ');
    const [, m, d] = datePart.split('-');
    const whenLabel = d && m ? `${d}/${m} ${timePart}` : cardTime;

    return (
      <div className="mt-2 pt-2 border-t border-border space-y-1.5">
        <p
          className="text-[11px] text-ink-muted tabular-nums leading-snug"
          title={`ยอดจากการ์ด KBank Live ในแชต LINE เมื่อ ${whenLabel} น.`}
        >
          จากแชต {whenLabel} น.
        </p>

        {gap === 0 ? (
          <Badge
            variant="income"
            className="whitespace-normal text-left leading-snug"
            title="ยอดในสมุดบัญชีตรงกับยอดในการ์ดแชต LINE (ส่วนต่าง ฿0.00)"
          >
            ตรงกับธนาคาร (฿0.00)
          </Badge>
        ) : gap > 0 ? (
          <Badge
            variant="warning"
            className="whitespace-normal text-left leading-snug tabular-nums"
            title={`ยอดในสมุดบัญชีมากกว่าแชต +฿${formatMoney(gap)} (อาจมีรายจ่ายตกหล่น)`}
          >
            ระบบมากกว่าธนาคาร +฿{formatMoney(gap)}
          </Badge>
        ) : (
          <Badge
            variant="warning"
            className="whitespace-normal text-left leading-snug tabular-nums"
            title={`ยอดในสมุดบัญชีน้อยกว่าแชต -฿${formatMoney(Math.abs(gap))} (อาจมีรายจ่ายซ้ำหรือรายรับตกหล่น)`}
          >
            ระบบน้อยกว่าธนาคาร -฿{formatMoney(Math.abs(gap))}
          </Badge>
        )}

        {gap !== 0 && (
          <div className="pt-0.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingAdjust({ account, gap })}
              disabled={adjustingAccount !== null}
              title={describeBalanceAdjustment(account, gap)}
              className="w-full text-[11px]"
            >
              {adjustingAccount === account ? 'กำลังปรับยอด...' : 'ปรับยอดให้ตรงธนาคาร'}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const accounts = [
    {
      key: 'K PLUS',
      label: 'K PLUS',
      balance: resolvedAccountBalances['K PLUS'] ?? 43253.07,
      icon: Landmark,
      hasCardStatus: true,
    },
    {
      key: 'Make by KBank',
      label: 'Make by KBank',
      balance: resolvedAccountBalances['Make by KBank'] ?? 3672.29,
      icon: Wallet,
      hasCardStatus: true,
    },
    {
      key: 'เป๋าตัง',
      label: 'เป๋าตัง',
      balance: resolvedAccountBalances['เป๋าตัง'] ?? 195.44,
      icon: Smartphone,
      hasCardStatus: false,
    },
    {
      key: 'เงินสด',
      label: 'เงินสด',
      balance: resolvedAccountBalances['เงินสด'] ?? 0,
      icon: Banknote,
      hasCardStatus: false,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Real Account Balances Card */}
      <Card className="overflow-hidden">
        <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-control bg-accent-soft border border-accent-border flex items-center justify-center text-accent-text shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-ink-muted">
                ยอดเงินคงเหลือรวมในบัญชีจริงและเงินสด
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-ink tracking-tight tabular-nums mt-0.5">
                {loading ? (
                  <span className="inline-block w-36 h-8 bg-surface-subtle animate-pulse rounded-control align-middle" />
                ) : (
                  `฿${formatMoney(resolvedTotalCash)}`
                )}
              </p>
            </div>
          </div>

          <span className="text-xs text-ink-muted self-start sm:self-center">
            สรุปยอดคงเหลือล่าสุดแยกตามบัญชี
          </span>
        </div>

        {/* Account Breakdown Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 sm:p-5 bg-surface-subtle/40">
          {accounts.map((acc) => {
            const Icon = acc.icon;
            return (
              <div
                key={acc.key}
                className="p-3.5 rounded-control bg-surface border border-border flex flex-col"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium text-ink-secondary">{acc.label}</span>
                    <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                  </div>
                  <p className="text-base sm:text-lg font-semibold text-ink tabular-nums tracking-tight">
                    {loading ? (
                      <span className="inline-block w-24 h-6 bg-surface-subtle animate-pulse rounded-badge" />
                    ) : (
                      `฿${formatMoney(acc.balance)}`
                    )}
                  </p>
                </div>

                {acc.hasCardStatus && renderCardStatus(acc.key)}
              </div>
            );
          })}
        </div>
      </Card>

      {adjustError && (
        <Alert variant="error" onDismiss={() => setAdjustError(null)}>
          {adjustError}
        </Alert>
      )}

      {/* 4 Period Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="p-4 sm:p-5 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-secondary truncate">{card.title}</span>
                <div
                  className={`w-8 h-8 rounded-control border flex items-center justify-center shrink-0 ${card.iconBg}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div>
                <p className={`text-lg sm:text-2xl font-bold tracking-tight tabular-nums ${card.amountClass}`}>
                  {loading ? (
                    <span className="inline-block w-20 sm:w-28 h-6 sm:h-7 bg-surface-subtle animate-pulse rounded-badge" />
                  ) : (
                    `${card.prefix}฿${formatMoney(card.amount)}`
                  )}
                </p>
                <span className="text-[11px] text-ink-muted block mt-1">{card.caption}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Balance Adjustment Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(pendingAdjust)}
        onClose={() => setPendingAdjust(null)}
        onConfirm={handleConfirmAdjust}
        title="ยืนยันการปรับยอดบัญชี"
        description={
          pendingAdjust ? describeBalanceAdjustment(pendingAdjust.account, pendingAdjust.gap) : ''
        }
        detail="รายการนี้ไม่นับเป็นรายรับหรือรายจ่าย และสามารถลบออกได้ในหน้ารายการทั้งหมด"
        confirmLabel="ยืนยันปรับยอด"
        cancelLabel="ยกเลิก"
        variant="primary"
        loading={adjustingAccount !== null}
        modalId="balance-adjustment-confirm"
      />
    </div>
  );
}
