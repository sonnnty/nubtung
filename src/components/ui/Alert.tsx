import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from './cn';

export type AlertVariant = 'info' | 'warning' | 'error' | 'success';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  role?: 'alert' | 'status';
}

const ALERT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-transfer-soft border-transfer-border text-ink',
  warning: 'bg-warning-soft border-warning-border text-ink',
  error: 'bg-expense-soft border-expense-border text-ink',
  success: 'bg-income-soft border-income-border text-ink',
};

const ICON_CLASSES: Record<AlertVariant, string> = {
  info: 'text-transfer',
  warning: 'text-warning',
  error: 'text-expense',
  success: 'text-income',
};

export function Alert({
  variant = 'info',
  title,
  children,
  action,
  onDismiss,
  className = '',
  role = variant === 'error' ? 'alert' : 'status',
}: AlertProps) {
  const Icon =
    variant === 'success'
      ? CheckCircle2
      : variant === 'warning'
      ? AlertTriangle
      : variant === 'error'
      ? AlertCircle
      : Info;

  return (
    <div
      role={role}
      className={cn(
        'p-3.5 sm:p-4 rounded-card border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm',
        ALERT_CLASSES[variant],
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_CLASSES[variant]}`} />
        <div className="min-w-0 leading-relaxed">
          {title && <p className="font-semibold text-ink mb-0.5">{title}</p>}
          <div className="text-ink-secondary">{children}</div>
        </div>
      </div>

      {(action || onDismiss) && (
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {action}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="ปิดการแจ้งเตือน"
              className="inline-flex items-center justify-center w-8 h-8 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
