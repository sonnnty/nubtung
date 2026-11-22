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
  Home,
  ShieldCheck,
} from 'lucide-react';
import type { MortgagePayment } from '@/lib/mortgage/types';
import { readJson } from '@/lib/utils/http';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Select,
  formatMoney,
} from '@/components/ui';

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
  const [pendingDeletePayment, setPendingDeletePayment] = useState<MortgagePayment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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

  const totalPages = Math.ceil(filteredPayments.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginated = useMemo(() => {
    return filteredPayments.slice(startIndex, startIndex + pageSize);
  }, [filteredPayments, startIndex, pageSize]);

  const handleConfirmDelete = async () => {
    if (!pendingDeletePayment?.id) return;
    const payment = pendingDeletePayment;

    setDeletingId(payment.id!);
    setActionMessage(null);

    try {
      const res = await fetch(`/api/mortgage/payments/${payment.id}`, {
        method: 'DELETE',
      });
      const data = await readJson(res);

      if (!res.ok) {
        throw new Error(data.error || 'ลบรายการไม่สำเร็จ');
      }

      setPendingDeletePayment(null);
      setActionMessage({ type: 'success', text: 'ลบรายการชำระเรียบร้อยแล้ว' });
      setTimeout(() => setActionMessage(null), 3000);
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setPendingDeletePayment(null);
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        {/* Header & Filter Bar */}
        <div className="p-4 sm:p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink tracking-tight flex items-center gap-2">
              <Receipt className="w-4 h-4 text-accent-text shrink-0" />
              <span>ประวัติการผ่อนชำระ</span>
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 tabular-nums">
              รวมรายการใบเสร็จ ธอส. ทั้งจากการซิงค์อัตโนมัติและการบันทึกเอง ({filteredPayments.length} รายการ)
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
              <Input
                type="text"
                aria-label="ค้นหาประวัติการผ่อนชำระ"
                placeholder="ค้นหาวันที่, รหัสใบเสร็จ..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-8 text-xs sm:w-52"
              />
            </div>

            <Select
              aria-label="กรองตามแหล่งที่มา"
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value as 'ALL' | 'EMAIL_SYNC' | 'MANUAL');
                setCurrentPage(1);
              }}
              className="text-xs sm:w-44"
            >
              <option value="ALL">แหล่งที่มาทั้งหมด</option>
              <option value="EMAIL_SYNC">ซิงค์จากอีเมล</option>
              <option value="MANUAL">บันทึกเอง</option>
            </Select>
          </div>
        </div>

        {/* Action Feedback */}
        {actionMessage && (
          <div className="px-4 sm:px-6 pt-4">
            <Alert
              variant={actionMessage.type === 'success' ? 'success' : 'error'}
              onDismiss={() => setActionMessage(null)}
            >
              {actionMessage.text}
            </Alert>
          </div>
        )}

        {/* 1. Mobile Card View (< md) */}
        <div className="block md:hidden divide-y divide-border">
          {loading ? (
            <div className="p-8 text-center text-xs text-ink-muted">
              กำลังโหลดประวัติการผ่อน...
            </div>
          ) : paginated.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-muted">ไม่พบรายการผ่อนชำระ</div>
          ) : (
            paginated.map((p) => {
              const isDeleting = deletingId === p.id;
              return (
                <div
                  key={p.id || `${p.accountId}-${p.paymentDate}`}
                  className="p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      <span className="text-xs font-semibold text-ink tabular-nums">
                        {p.paymentDate}
                      </span>
                      {p.installmentNo && (
                        <Badge variant="neutral" className="tabular-nums">
                          งวด {p.installmentNo}
                        </Badge>
                      )}
                    </div>

                    <Badge variant={p.source === 'EMAIL_SYNC' ? 'income' : 'warning'}>
                      {p.source === 'EMAIL_SYNC' ? (
                        <Mail className="w-3 h-3" />
                      ) : (
                        <Edit3 className="w-3 h-3" />
                      )}
                      <span>{p.source === 'EMAIL_SYNC' ? 'ธอส. Email' : 'บันทึกเอง'}</span>
                    </Badge>
                  </div>

                  <p className="text-xs text-ink-muted">
                    {ACCOUNT_NAMES[p.accountId] || p.accountId}
                  </p>

                  {/* Breakdown Grid */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-control bg-surface-subtle/50 border border-border text-xs tabular-nums">
                    <div>
                      <span className="text-ink-muted block text-[11px]">เงินต้น</span>
                      <span className="font-semibold text-income">฿{formatMoney(p.principal)}</span>
                    </div>
                    <div>
                      <span className="text-ink-muted block text-[11px]">ดอกเบี้ย</span>
                      <span className="font-semibold text-warning">฿{formatMoney(p.interest)}</span>
                    </div>
                    <div>
                      <span className="text-ink-muted block text-[11px]">ประกัน/ธรรมเนียม</span>
                      <span className="font-semibold text-transfer">฿{formatMoney(p.fee)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs tabular-nums">
                    <div>
                      <span className="text-ink-muted mr-1.5">คงเหลือ</span>
                      <span className="font-medium text-ink">฿{formatMoney(p.remainingBalance)}</span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-ink text-sm">฿{formatMoney(p.totalPaid)}</span>
                      {p.id && (
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => setPendingDeletePayment(p)}
                          disabled={isDeleting}
                          title="ลบรายการ"
                          aria-label="ลบรายการชำระนี้"
                          className="hover:text-expense hover:border-expense-border"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 2. Desktop Statement Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-surface-subtle text-ink-secondary font-medium border-b border-border">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">วันที่ชำระ</th>
                <th className="px-4 py-3 whitespace-nowrap">บัญชีสินเชื่อ</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">งวดที่</th>
                <th className="px-4 py-3 text-right whitespace-nowrap text-ink font-semibold">
                  ยอดชำระรวม
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap text-income">เงินต้น</th>
                <th className="px-4 py-3 text-right whitespace-nowrap text-warning">ดอกเบี้ย</th>
                <th className="px-4 py-3 text-right whitespace-nowrap text-transfer">
                  ประกัน/ธรรมเนียม
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">ยอดหนี้คงเหลือ</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">ที่มา</th>
                <th className="px-3 py-3 text-center whitespace-nowrap w-16">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-ink tabular-nums">
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-ink-muted">
                    กำลังโหลดข้อมูลประวัติการผ่อน...
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-ink-muted">
                    ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                paginated.map((p) => {
                  const isDeleting = deletingId === p.id;
                  return (
                    <tr
                      key={p.id || `${p.accountId}-${p.paymentDate}`}
                      className="hover:bg-surface-subtle/50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-ink">
                        {p.paymentDate}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          {p.accountId === '011690010474' ? (
                            <>
                              <Home className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                              <span>บ้านหลัก</span>
                            </>
                          ) : p.accountId === '011690010482' ? (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                              <span>MRTA</span>
                            </>
                          ) : (
                            <span>{p.accountId}</span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-ink-muted block">
                          {p.accountId}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-center text-ink-muted">
                        {p.installmentNo ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-ink">
                        ฿{formatMoney(p.totalPaid)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-income">
                        ฿{formatMoney(p.principal)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-warning">
                        ฿{formatMoney(p.interest)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-transfer">
                        {p.fee > 0 ? `฿${formatMoney(p.fee)}` : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-ink-secondary">
                        ฿{formatMoney(p.remainingBalance)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <Badge variant={p.source === 'EMAIL_SYNC' ? 'income' : 'warning'}>
                          {p.source === 'EMAIL_SYNC' ? (
                            <Mail className="w-3 h-3" />
                          ) : (
                            <Edit3 className="w-3 h-3" />
                          )}
                          <span>{p.source === 'EMAIL_SYNC' ? 'ธอส. Email' : 'บันทึกเอง'}</span>
                        </Badge>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-center">
                        {p.id ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingDeletePayment(p)}
                            disabled={isDeleting}
                            title="ลบรายการนี้"
                            aria-label="ลบรายการชำระนี้"
                            className="hover:text-expense hover:bg-expense-soft"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <span className="text-ink-muted">—</span>
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
          <div className="px-4 py-3.5 border-t border-border bg-surface-subtle/40 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ink-muted tabular-nums">
            <div>
              แสดง {startIndex + 1} - {Math.min(startIndex + pageSize, filteredPayments.length)} จาก{' '}
              {filteredPayments.length} รายการ
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-label="หน้าก่อนหน้า"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-3 py-1.5 bg-surface border border-border rounded-control text-ink font-medium">
                หน้า {safeCurrentPage} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="icon"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-label="หน้าถัดไป"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Delete Payment Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(pendingDeletePayment)}
        onClose={() => setPendingDeletePayment(null)}
        onConfirm={handleConfirmDelete}
        title="ยืนยันการลบรายการผ่อนชำระ"
        description={
          pendingDeletePayment
            ? `คุณแน่ใจหรือไม่ว่าต้องการลบรายการชำระวันที่ ${pendingDeletePayment.paymentDate} ยอด ฿${formatMoney(pendingDeletePayment.totalPaid)}?`
            : ''
        }
        confirmLabel="ลบรายการ"
        cancelLabel="ยกเลิก"
        variant="destructive"
        loading={deletingId !== null}
        modalId="delete-mortgage-payment-confirm"
      />
    </>
  );
}
