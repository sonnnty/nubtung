import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import MobileBottomNav from '@/components/MobileBottomNav';
import MortgageDashboard from '@/components/Mortgage/MortgageDashboard';

export const metadata: Metadata = {
  title: 'ผ่อนบ้าน (Mortgage) | นับตังค์ - Nubtang',
  description: 'ติดตามการผ่อนบ้าน ธอส. ประวัติการชำระ และจำลองการโปะเงินกู้',
};

export default function MortgagePage() {
  return (
    <div className="min-h-screen flex flex-col bg-canvas transition-colors">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 pb-28 md:pb-10">
        <MortgageDashboard />
      </main>

      <MobileBottomNav />
    </div>
  );
}
