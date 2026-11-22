import React from 'react';

export type BadgeVariant = 'neutral' | 'accent' | 'income' | 'expense' | 'transfer' | 'warning';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-subtle text-ink-secondary border-border',
  accent: 'bg-accent-soft text-accent-text border-accent-border',
  income: 'bg-income-soft text-income border-income-border',
  expense: 'bg-expense-soft text-expense border-expense-border',
  transfer: 'bg-transfer-soft text-transfer border-transfer-border',
  warning: 'bg-warning-soft text-warning border-warning-border',
};

export function Badge({ variant = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-badge border text-[11px] font-medium leading-tight whitespace-nowrap ${BADGE_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
