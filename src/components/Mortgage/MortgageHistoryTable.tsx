'use client';

import { useState, useMemo } from 'react';
import {
  Calendar,
  Trash2,
  Mail,
  Edit3,
  Search,
  ChevronLeft,
  ChevronRight,
  Receipt,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { MortgagePayment } from '@/lib/mortgage/types';
import { readJson } from '@/lib/utils/http';

interface MortgageHistoryTableProps {
  payments: MortgagePayment[];
  loading?: boolean;
  onRefresh?: () => void;
}

const ACCOUNT_NAMES: Record<string, string> = {
  '011690010474': 'สินเชื่อบ้านหลัก (011690010474)',
  '011690010482': 'สินเชื่อ MRTA (011690010482)',
};

export default function MortgageHistoryTable({
  payments,
  loading = false,
  onRefresh,
}: MortgageHistoryTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSource, setSelectedSource] = useState<'ALL' | 'EMAIL_SYNC' | 'MANUAL'>('ALL');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter & sort payments descending by payment date
  const filteredPayments = useMemo(() => {
    const sorted = [...payments].sort((a, b) => {
      const dateDiff = b.paymentDate.localeCompare(a.paymentDate);
      if (dateDiff !== 0) return dateDiff;
      return (b.id || 0) - (a.id || 0);
    });

    return sorted.filter((p) => {
      const matchSearch =
        p.paymentDate.includes(searchTerm) ||
        (p.receiptUid && p.receiptUid.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (p.installmentNo && String(p.installmentNo).includes(searchTerm));

      const matchSource = selectedSource === 'ALL' || p.source === selectedSource;

      return matchSearch && matchSource;
    });
  }, [payments, searchTerm, selectedSource]);

  // Pagination
  const totalPages = Math.ceil(filteredPayments.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginated = useMemo(() => {
    return filteredPayments.slice(startIndex, startIndex + pageSize);
  }, [filteredPayments, startIndex, pageSize]);

  const handleDelete = async (payment: MortgagePayment) => {
    if (!payment.id) return;

    const formattedAmount = payment.totalPaid.toLocaleString('th-TH', { minimumFractionDigits: 2 });
    if (
      !confirm(
        `คุณแน่ใจหรือไม่ว่าต้องการลบรายการชำระวันที่ ${payment.paymentDate} ยอด ฿${formattedAmount}?`
      )
    ) {
      return;
    }

    setDeletingId(payment.id);
    setActionMessage(null);

    try {
      const res = await fetch(`/api/mortgage/payments/${payment.id}`, {
        method: 'DELETE',
      });
      const data = await readJson(res);

      if (!res.ok) {
        throw new Error(data.error || 'ลบรายการไม่สำเร็จ');
      }

      setActionMessage({ type: 'success', text: 'ลบรายการสำเร็จ' });
      setTimeout(() => setActionMessage(null), 3000);
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden">
      {/* Header & Filter Bar */}
      <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>ประวัติการผ่อนชำระ (Payment History)</span>
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            รวมรายการใบเสร็จ ธอส. ทั้งจากการซิงค์อัตโนมัติและการบันทึกเอง ({filteredPayments.length} รายการ)
          </p>
        </div>

        {/* Search & Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาวันที่, รหัสใบเสร็จ..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44 sm:w-52"
            />
          </div>

          {/* Source Filter */}
          <select
            value={selectedSource}
            onChange={(e) => {
              setSelectedSource(e.target.value as 'ALL' | 'EMAIL_SYNC' | 'MANUAL');
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="ALL">แหล่งที่มาทั้งหมด</option>
            <option value="EMAIL_SYNC">📥 ซิงค์จากอีเมล</option>
            <option value="MANUAL">✍️ บันทึกเอง</option>
          </select>
        </div>
      </div>

      {/* Action Message Banner */}
      {actionMessage && (
        <div
          className={`mx-4 sm:mx-6 mt-4 p-3 rounded-2xl flex items-center gap-2 text-xs font-medium ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-500" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* 1. Mobile Card View (< md) */}
      <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
            กำลังโหลดประวัติการผ่อน...
          </div>
        ) : paginated.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            ไม่พบรายการผ่อนชำระ
          </div>
        ) : (
          paginated.map((p) => {
            const isDeleting = deletingId === p.id;
            return (
              <div key={p.id || `${p.accountId}-${p.paymentDate}`} className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {p.paymentDate}
                    </span>
                    {p.installmentNo && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                        งวด {p.installmentNo}
                      </span>
                    )}
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      p.source === 'EMAIL_SYNC'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    {p.source === 'EMAIL_SYNC' ? <Mail className="w-2.5 h-2.5" /> : <Edit3 className="w-2.5 h-2.5" />}
                    <span>{p.source === 'EMAIL_SYNC' ? 'ธอส. Email' : 'บันทึกเอง'}</span>
                  </span>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {ACCOUNT_NAMES[p.accountId] || p.accountId}
                </div>

                {/* Amount breakdown */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">เงินต้น</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      ฿{p.principal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">ดอกเบี้ย</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">
                      ฿{p.interest.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">ค่าธรรมเนียม/ประกัน</span>
                    <span className="font-bold text-sky-600 dark:text-sky-400">
                      ฿{p.fee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 mr-1.5">คงเหลือ:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      ฿{p.remainingBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      ฿{p.totalPaid.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                    {p.id && (
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        disabled={isDeleting}
                        title="ลบรายการ"
                        className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 bg-slate-100 dark:bg-slate-800 rounded-lg disabled:opacity-30"
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${isDeleting ? 'animate-spin text-rose-500' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 2. Desktop Table View (>= md) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-semibold uppercase text-[11px] border-b border-slate-200/70 dark:border-slate-800">
            <tr>
              <th className="px-5 py-3.5">วันที่ชำระ</th>
              <th className="px-4 py-3.5">บัญชีสินเชื่อ</th>
              <th className="px-4 py-3.5 text-center">งวดที่</th>
              <th className="px-4 py-3.5 text-right font-bold text-slate-900 dark:text-white">ยอดชำระรวม</th>
              <th className="px-4 py-3.5 text-right text-emerald-600 dark:text-emerald-400">เงินต้น</th>
              <th className="px-4 py-3.5 text-right text-amber-600 dark:text-amber-400">ดอกเบี้ย</th>
              <th className="px-4 py-3.5 text-right text-sky-600 dark:text-sky-400">ประกัน/ค่าธรรมเนียม</th>
              <th className="px-4 py-3.5 text-right">ยอดหนี้คงเหลือ</th>
              <th className="px-4 py-3.5 text-center">ที่มา</th>
              <th className="px-3 py-3.5 text-center w-14">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={10} className="text-center py-10 text-slate-400">
                  กำลังโหลดข้อมูลประวัติการผ่อน...
                </td>
              </tr>
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-10 text-slate-400">
                  ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
                </td>
              </tr>
            ) : (
              paginated.map((p) => {
                const isDeleting = deletingId === p.id;
                return (
                  <tr
                    key={p.id || `${p.accountId}-${p.paymentDate}`}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-5 py-3.5 whitespace-nowrap font-medium text-slate-900 dark:text-white">
                      {p.paymentDate}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {p.accountId === '011690010474'
                          ? '🏠 บ้านหลัก'
                          : p.accountId === '011690010482'
                          ? '🛡️ MRTA'
                          : p.accountId}
                      </span>
                      <span className="text-[10px] text-slate-400 block">{p.accountId}</span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-center text-slate-500">
                      {p.installmentNo ?? '-'}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right font-extrabold text-slate-900 dark:text-white">
                      ฿{p.totalPaid.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      ฿{p.principal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right font-semibold text-amber-600 dark:text-amber-400">
                      ฿{p.interest.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right font-semibold text-sky-600 dark:text-sky-400">
                      {p.fee > 0 ? `฿${p.fee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right font-semibold text-slate-800 dark:text-slate-200">
                      ฿{p.remainingBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          p.source === 'EMAIL_SYNC'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {p.source === 'EMAIL_SYNC' ? (
                          <Mail className="w-2.5 h-2.5" />
                        ) : (
                          <Edit3 className="w-2.5 h-2.5" />
                        )}
                        <span>{p.source === 'EMAIL_SYNC' ? 'ธอส. Email' : 'บันทึกเอง'}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-center">
                      {p.id ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={isDeleting}
                          title="ลบรายการนี้"
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors disabled:opacity-30"
                        >
                          <Trash2 className={`w-3.5 h-3.5 ${isDeleting ? 'animate-spin text-rose-500' : ''}`} />
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div>
            แสดง {startIndex + 1} - {Math.min(startIndex + pageSize, filteredPayments.length)} จาก {filteredPayments.length} รายการ
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-medium">
              หน้า {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
