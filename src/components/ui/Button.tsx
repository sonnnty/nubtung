'use client';

import React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg border border-transparent hover:bg-accent-hover',
  secondary:
    'bg-surface text-ink border border-border-strong hover:bg-surface-subtle',
  destructive:
    'bg-expense-solid text-white border border-transparent hover:bg-expense-solid-hover',
  ghost:
    'bg-transparent text-ink-secondary border border-transparent hover:bg-surface-subtle hover:text-ink',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-9 sm:min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-xs sm:text-sm',
  icon: 'h-10 w-10 sm:h-9 sm:w-9 p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
