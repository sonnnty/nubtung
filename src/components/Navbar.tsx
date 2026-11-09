'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Wallet, LayoutDashboard, ListOrdered, Calculator, Home, LogOut } from 'lucide-react';
import SyncButton from './SyncButton';
import ThemeToggle from './ThemeToggle';
import SheetMirrorStatus from './SheetMirrorStatus';

export default function Navbar({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const navItems = [
    { label: 'ภาพรวม (Dashboard)', href: '/', icon: LayoutDashboard },
    { label: 'รายการทั้งหมด (Transactions)', href: '/transactions', icon: ListOrdered },
    { label: 'คำนวณภาษี (Tax)', href: '/tax', icon: Calculator },
    { label: 'ผ่อนบ้าน (Mortgage)', href: '/mortgage', icon: Home },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
          {/* Brand logo */}
          <Link href="/" className="flex items-center gap-2.5 sm:gap-3 shrink-0 group">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-emerald-500/20 shadow-md group-hover:scale-105 transition-transform shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <span className="text-base sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">นับตังค์</span>
              <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 block font-semibold uppercase tracking-wider leading-none">Nubtang Finance</span>
            </div>
          </Link>

          {/* Navigation links */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-100/70 dark:bg-slate-800/50 p-1 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <SheetMirrorStatus />

            {/* Sync button for all screens (icon only on mobile, text on desktop) */}
            <SyncButton onSyncComplete={onSyncComplete} />

            <ThemeToggle />

            <button
              onClick={handleLogout}
              title="ออกจากระบบ"
              className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
