'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  badge?: React.ReactNode;
  size?: ModalSize;
  className?: string;
  stickyHeader?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  ariaLabel?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  disableClose?: boolean;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0 && !el.hasAttribute('aria-hidden')
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  badge,
  size = 'md',
  className,
  stickyHeader,
  footer,
  children,
  ariaLabel,
  initialFocusRef,
  disableClose = false,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const rafId = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (initialFocusRef?.current && dialog.contains(initialFocusRef.current)) {
        initialFocusRef.current.focus();
        return;
      }

      const autofocusEl = dialog.querySelector<HTMLElement>('[data-autofocus]');
      if (autofocusEl && autofocusEl.getClientRects().length > 0) {
        autofocusEl.focus();
        return;
      }

      const bodyFocusable = getFocusableElements(bodyRef.current);
      if (bodyFocusable.length > 0) {
        bodyFocusable[0].focus();
        return;
      }

      const allFocusable = getFocusableElements(dialog);
      if (allFocusable.length > 0) {
        allFocusable[0].focus();
        return;
      }

      dialog.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);
      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen, initialFocusRef]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 transition-opacity duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disableClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'bg-surface border border-border rounded-t-card sm:rounded-card shadow-popover w-full max-h-[92vh] flex flex-col overflow-hidden overscroll-contain focus:outline-none',
          SIZE_CLASSES[size],
          className
        )}
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
              disabled={disableClose}
              aria-label="ปิดหน้าต่าง"
              className="inline-flex items-center justify-center w-9 h-9 rounded-control text-ink-muted hover:text-ink hover:bg-surface-subtle transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {stickyHeader && (
          <div className="px-5 py-4 border-b border-border shrink-0 space-y-3 bg-surface">
            {stickyHeader}
          </div>
        )}

        <div
          ref={bodyRef}
          className={cn(
            'flex-1 overflow-y-auto px-5 py-4 custom-scrollbar',
            !footer && 'pb-[max(2rem,env(safe-area-inset-bottom))] sm:pb-4'
          )}
        >
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
