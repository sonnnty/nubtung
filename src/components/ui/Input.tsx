'use client';

import React from 'react';

export const INPUT_BASE_CLASS =
  'w-full min-h-10 px-3 py-2 text-sm bg-surface text-ink border border-border-strong rounded-control placeholder:text-ink-muted transition-colors duration-150 focus:outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-border disabled:bg-surface-subtle disabled:text-ink-muted disabled:cursor-not-allowed';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className = '', ...props }, ref) => (
    <label
      ref={ref}
      className={`block text-xs font-medium text-ink-secondary mb-1.5 ${className}`}
      {...props}
    />
  )
);
Label.displayName = 'Label';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`${INPUT_BASE_CLASS} ${className}`} {...props} />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => (
    <textarea ref={ref} className={`${INPUT_BASE_CLASS} min-h-20 leading-relaxed ${className}`} {...props} />
  )
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...props }, ref) => (
    <select ref={ref} className={`${INPUT_BASE_CLASS} ${className}`} {...props} />
  )
);
Select.displayName = 'Select';
