'use client';

import React, { useId } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  badge?: React.ReactNode;
  size?: ModalSize;
  footer?: React.ReactNode;
  children: React.ReactNode;
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  badge,
  size = 'md',
  footer,
  children,
  ariaLabel,
}: ModalProps) {
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 transition-opacity duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-surface border border-border rounded-t-card sm:rounded-card shadow-popover w-full ${SIZE_CLASSES[size]} max-h-[92vh] flex flex-col overflow-hidden overscroll-contain`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description || badge) && (
          <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {badge}
                {title && (
                  <h2 id={titleId} className="text-base font-semibold text-ink tracking-tight">
                    {title}
                  </h2>
                )}
              </div>
              {description && <p className="text-xs text-ink-muted">{description}</p>}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="inline-flex items-center justify-center w-9 h-9 rounded-control text-ink-muted hover:text-ink hover:bg-surface-subtle transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-3.5 border-t border-border bg-surface-subtle/50 flex items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
