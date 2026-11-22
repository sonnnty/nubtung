'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Wallet, LayoutDashboard, ListOrdered, Calculator, Home, LogOut } from 'lucide-react';
import SyncButton from './SyncButton';
import ThemeToggle from './ThemeToggle';
import SheetMirrorStatus from './SheetMirrorStatus';
import { Button } from './ui';

export default function Navbar({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const navItems = [
    { label: 'ภาพรวม', href: '/', icon: LayoutDashboard },
    { label: 'รายการทั้งหมด', href: '/transactions', icon: ListOrdered },
    { label: 'คำนวณภาษี', href: '/tax', icon: Calculator },
    { label: 'ผ่อนบ้าน', href: '/mortgage', icon: Home },
  ];

  return (
    <header className="sticky top-0 z-40 bg-surface border-b border-border transition-colors">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-3">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2.5 shrink-0 rounded-control focus-visible:outline-2"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-control bg-accent flex items-center justify-center text-accent-fg shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-sm sm:text-base font-semibold text-ink tracking-tight block leading-tight">
                นับตังค์
              </span>
              <span className="text-[10px] text-ink-muted block font-medium uppercase tracking-widest leading-none mt-0.5">
                Nubtang
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav aria-label="เมนูหลัก" className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2 px-3 py-2 rounded-control text-xs font-medium border transition-colors duration-150 whitespace-nowrap ${
                    isActive
                      ? 'bg-accent-soft text-accent-text border-accent-border font-semibold'
                      : 'bg-transparent text-ink-secondary border-transparent hover:text-ink hover:bg-surface-subtle'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <SheetMirrorStatus />
            <SyncButton onSyncComplete={onSyncComplete} />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="text-ink-muted hover:text-expense hover:bg-expense-soft shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
