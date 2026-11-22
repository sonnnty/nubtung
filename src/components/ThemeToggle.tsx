'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { Sun, Moon } from 'lucide-react';
import { Button } from './ui';

const emptySubscribe = () => () => {};

export default function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="w-10 h-10 sm:w-9 sm:h-9 rounded-control border border-border bg-surface-subtle"
      />
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      className="text-ink-secondary hover:text-ink"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
