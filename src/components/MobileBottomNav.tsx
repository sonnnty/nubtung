'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListOrdered, Calculator, Home } from 'lucide-react';
import ManualTransactionModal from './Transactions/ManualTransactionModal';

interface MobileBottomNavProps {
  onSyncComplete?: () => void;
  onRefresh?: () => void;
}

export default function MobileBottomNav({ onSyncComplete, onRefresh }: MobileBottomNavProps) {
  const pathname = usePathname();

  const linkClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 min-h-12 px-1 py-1.5 rounded-control transition-colors duration-150 ${
      active
        ? 'text-accent-text font-semibold'
        : 'text-ink-muted hover:text-ink'
    }`;

  const iconWrapClass = (active: boolean) =>
    `flex items-center justify-center w-8 h-7 rounded-badge transition-colors ${
      active ? 'bg-accent-soft' : ''
    }`;

  return (
    <nav
      aria-label="เมนูหลักมือถือ"
      className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-surface border-t border-border px-2 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-5 items-center max-w-md mx-auto">
        <Link
          href="/"
          aria-current={pathname === '/' ? 'page' : undefined}
          className={linkClass(pathname === '/')}
        >
          <span className={iconWrapClass(pathname === '/')}>
            <LayoutDashboard className="w-4 h-4" />
          </span>
          <span className="text-[11px] leading-none">ภาพรวม</span>
        </Link>

        <Link
          href="/transactions"
          aria-current={pathname === '/transactions' ? 'page' : undefined}
          className={linkClass(pathname === '/transactions')}
        >
          <span className={iconWrapClass(pathname === '/transactions')}>
            <ListOrdered className="w-4 h-4" />
          </span>
          <span className="text-[11px] leading-none">รายการ</span>
        </Link>

        <div className="flex flex-col items-center justify-center gap-0.5 py-0.5">
          <ManualTransactionModal
            onSuccess={() => {
              if (onSyncComplete) onSyncComplete();
              if (onRefresh) onRefresh();
            }}
            isMobileFab={true}
          />
          <span className="text-[10px] text-ink-muted font-medium leading-none">บันทึก</span>
        </div>

        <Link
          href="/tax"
          aria-current={pathname === '/tax' ? 'page' : undefined}
          className={linkClass(pathname === '/tax')}
        >
          <span className={iconWrapClass(pathname === '/tax')}>
            <Calculator className="w-4 h-4" />
          </span>
          <span className="text-[11px] leading-none">ภาษี</span>
        </Link>

        <Link
          href="/mortgage"
          aria-current={pathname === '/mortgage' ? 'page' : undefined}
          className={linkClass(pathname === '/mortgage')}
        >
          <span className={iconWrapClass(pathname === '/mortgage')}>
            <Home className="w-4 h-4" />
          </span>
          <span className="text-[11px] leading-none">ผ่อนบ้าน</span>
        </Link>
      </div>
    </nav>
  );
}
