'use client';

import { useState, useMemo } from 'react';
import { Transaction, TransactionType } from '@/types';
import {
  ExternalLink,
  Search,
  Trash2,
  Edit3,
  Check,
  Save,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CopyCheck,
} from 'lucide-react';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';
import { isBalanceAdjustment } from '@/lib/balance/balance-adjustment';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
  formatMoney,
} from '@/components/ui';

interface TransactionTableProps {
  transactions: Transaction[];
  loading: boolean;
  onRefresh?: () => void;
}

const PENDING_CATEGORY = 'รอระบุ';

const CATEGORIES = [
  'อาหารและเครื่องดื่ม',
  'ของใช้ในบ้าน/ซูเปอร์',
  'การเดินทาง/ค่าน้ำมัน',
  'ช้อปปิ้ง',
  'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)',
  'บันเทิง/สตรีมมิ่ง',
  'สุขภาพ/ยา',
  'โอนระหว่างบัญชี',
  'เงินเดือน/รายรับ',
  'อื่นๆ',
];

export default function TransactionTable({ transactions, loading, onRefresh }: TransactionTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedAccount, setSelectedAccount] = useState<string>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeduplicating, setIsDeduplicating] = useState(false);

  // Confirm Dialogs & Inline Feedback
  const [pendingDeleteTx, setPendingDeleteTx] = useState<Transaction | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDedupeOpen, setConfirmDedupeOpen] = useState(false);
  const [dedupeError, setDedupeError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Quick Note Edit Modal (for Auto-sync transactions)
  const [editingNoteTx, setEditingNoteTx] = useState<Transaction | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const { closeModal: closeNoteEdit } = useHistoryModal({
    isOpen: Boolean(editingNoteTx),
    onClose: () => setEditingNoteTx(null),
    modalId: 'edit-note-tx',
    enableEsc: !isSavingNote,
  });
  const [editNoteText, setEditNoteText] = useState('');
  const [editNoteCategory, setEditNoteCategory] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  // Full Edit Modal (for Manual transactions)
  const [editingManualTx, setEditingManualTx] = useState<Transaction | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const { closeModal: closeManualEdit } = useHistoryModal({
    isOpen: Boolean(editingManualTx),
    onClose: () => setEditingManualTx(null),
    modalId: 'edit-manual-tx',
    enableEsc: !isSavingManual,
  });
  const [manualType, setManualType] = useState<TransactionType>('EXPENSE');
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategory, setManualCategory] = useState(CATEGORIES[0]);
  const [manualAccount, setManualAccount] = useState('K PLUS');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Filter and sort transactions (strictly latest first)
  const filtered = useMemo(() => {
    const list = transactions.filter((tx) => {
      const matchSearch =
        (tx.note || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tx.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tx.account || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchType =
        selectedType === 'ALL' ||
        (selectedType === 'PENDING' ? tx.category === PENDING_CATEGORY : tx.type === selectedType);
      const matchAccount = selectedAccount === 'ALL' || tx.account === selectedAccount;

      return matchSearch && matchType && matchAccount;
    });

    return list.sort((a, b) => {
      const dtA = `${a.date}T${a.time}`;
      const dtB = `${b.date}T${b.time}`;
      const timeA = new Date(dtA).getTime();
      const timeB = new Date(dtB).getTime();
      if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
        return timeB - timeA;
      }
      return dtB.localeCompare(dtA);
    });
  }, [transactions, searchTerm, selectedType, selectedAccount]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const paginatedTransactions = useMemo(() => {
    return filtered.slice(startIndex, endIndex);
  }, [filtered, startIndex, endIndex]);

  const handleConfirmDelete = async () => {
    if (!pendingDeleteTx) return;
    const tx = pendingDeleteTx;

    setDeletingId(tx.id);
    setDeleteError(null);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/transactions?id=${encodeURIComponent(tx.id)}`, {
        method: 'DELETE',
      });
      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete transaction');
      }
      setPendingDeleteTx(null);
      setActionMessage({ type: 'success', text: 'ลบรายการเรียบร้อยแล้ว' });
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setDeleteError(`ลบรายการไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenEdit = (tx: Transaction) => {
    if (tx.source === 'MANUAL') {
      setEditingManualTx(tx);
      setManualType(tx.type);
      setManualAmount(tx.amount.toString());
      setManualCategory(tx.category || CATEGORIES[0]);
      setManualAccount(tx.account || 'K PLUS');
      setManualDate(tx.date);
      setManualTime(tx.time || '');
      setManualNote(tx.note || '');
      setManualError(null);
    } else {
      setEditingNoteTx(tx);
      setEditNoteText(tx.note || '');
      setEditNoteCategory(tx.category === PENDING_CATEGORY ? '' : tx.category);
      setNoteError(null);
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNoteTx) return;

    setIsSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch('/api/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingNoteTx.id,
          note: editNoteText,
          ...(editingNoteTx.category === PENDING_CATEGORY && editNoteCategory
            ? { category: editNoteCategory }
            : {}),
        }),
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update note');
      }

      closeNoteEdit();
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setNoteError(
        `บันทึกรายละเอียดไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingManualTx) return;

    setIsSavingManual(true);
    setManualError(null);
    try {
      const parsedAmount = parseFloat(manualAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('กรุณากรอกจำนวนเงินให้ถูกต้อง');
      }

      const res = await fetch('/api/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingManualTx.id,
          type: manualType,
          amount: parsedAmount,
          category: manualCategory,
          account: manualAccount,
          date: manualDate,
          time: manualTime,
          note: manualNote,
        }),
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update transaction');
      }

      closeManualEdit();
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setManualError(
        `แก้ไขรายการไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleConfirmDeduplicate = async () => {
    setIsDeduplicating(true);
    setDedupeError(null);
    setActionMessage(null);
    try {
      const res = await fetch('/api/transactions/deduplicate', { method: 'POST' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to deduplicate');
      setConfirmDedupeOpen(false);
      setActionMessage({
        type: 'success',
        text: data.message || 'ลบรายการซ้ำเรียบร้อยแล้ว',
      });
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      setDedupeError(`เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDeduplicating(false);
    }
  };

  const getTypeMeta = (type: TransactionType) => {
    if (type === 'INCOME') {
      return {
        variant: 'income' as const,
        label: 'รายรับ',
        amountClass: 'text-income',
        prefix: '+',
      };
    }
    if (type === 'TRANSFER') {
      return {
        variant: 'transfer' as const,
        label: 'โอนย้าย',
        amountClass: 'text-transfer',
        prefix: '',
      };
    }
    return {
      variant: 'expense' as const,
      label: 'รายจ่าย',
      amountClass: 'text-expense',
      prefix: '-',
    };
  };

  const resolveSlipLink = (tx: Transaction) =>
    tx.slipUrl && tx.slipUrl.startsWith('http')
      ? tx.slipUrl
      : tx.driveFileId && tx.driveFileId.length > 10
      ? `https://drive.google.com/file/d/${tx.driveFileId}/view`
      : null;

  return (
    <>
      <Card className="overflow-hidden">
        {/* Table Controls */}
        <div className="p-3.5 sm:p-4 border-b border-border flex flex-col lg:flex-row gap-2.5 lg:items-center justify-between">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              aria-label="ค้นหารายการ"
              placeholder="ค้นหารายการ, ร้านค้า, หมวดหมู่..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 text-xs sm:text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 w-full lg:flex lg:w-auto lg:items-center">
            <Select
              aria-label="กรองตามประเภท"
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              className="text-xs px-2.5 lg:w-36"
            >
              <option value="ALL">ทุกประเภท</option>
              <option value="EXPENSE">รายจ่าย</option>
              <option value="INCOME">รายรับ</option>
              <option value="TRANSFER">โอนย้าย</option>
              <option value="PENDING">{PENDING_CATEGORY}</option>
            </Select>

            <Select
              aria-label="กรองตามบัญชี"
              value={selectedAccount}
              onChange={(e) => {
                setSelectedAccount(e.target.value);
                setCurrentPage(1);
              }}
              className="text-xs px-2.5 lg:w-36"
            >
              <option value="ALL">ทุกบัญชี</option>
              <option value="K PLUS">K PLUS</option>
              <option value="Make by KBank">Make by KBank</option>
              <option value="เป๋าตัง">เป๋าตัง</option>
              <option value="เงินสด">เงินสด</option>
            </Select>

            <Select
              aria-label="จำนวนแถวต่อหน้า"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="text-xs px-2.5 lg:w-28"
            >
              <option value={20}>20 แถว</option>
              <option value={50}>50 แถว</option>
              <option value={100}>100 แถว</option>
              <option value={200}>200 แถว</option>
            </Select>

            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setDedupeError(null);
                setConfirmDedupeOpen(true);
              }}
              disabled={isDeduplicating || loading}
              title="ตรวจสอบและลบรายการที่ซ้ำกันใน Google Sheets"
              className="col-span-3 lg:col-span-1 text-xs whitespace-nowrap"
            >
              <CopyCheck className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
              <span>{isDeduplicating ? 'กำลังล้าง...' : 'ลบรายการซ้ำ'}</span>
            </Button>
          </div>
        </div>

        {/* Inline Action Feedback */}
        {actionMessage && (
          <div className="px-3.5 sm:px-4 pt-3.5">
            <Alert
              variant={actionMessage.type === 'success' ? 'success' : 'error'}
              onDismiss={() => setActionMessage(null)}
            >
              {actionMessage.text}
            </Alert>
          </div>
        )}

        {/* 1. Mobile Feed View (< md) */}
        <div className="block md:hidden p-3 space-y-2.5 bg-surface-subtle/40">
          {loading ? (
            <div className="p-8 text-center text-xs text-ink-muted">
              กำลังโหลดข้อมูลรายการ...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-muted">
              ไม่พบรายการที่ตรงกับเงื่อนไข
            </div>
          ) : (
            paginatedTransactions.map((tx, idx) => {
              const meta = getTypeMeta(tx.type);
              const isManual = tx.source === 'MANUAL';
              const isDeleting = deletingId === tx.id;
              const slipLink = resolveSlipLink(tx);

              return (
                <div
                  key={`m-${tx.id || 'm-row'}-${idx}`}
                  className="bg-surface rounded-card p-3.5 border border-border shadow-card space-y-2.5"
                >
                  {/* Top row: badge + timestamp on left, amount on right */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-[11px] text-ink-muted tabular-nums">
                        {tx.date}
                        {tx.time ? ` ${tx.time}` : ''}
                      </span>
                    </div>

                    <span className={`text-sm font-semibold tabular-nums shrink-0 ${meta.amountClass}`}>
                      {meta.prefix}฿{formatMoney(tx.amount)}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs font-medium text-ink leading-snug" title={tx.note || tx.category}>
                    {tx.note || <span className="text-ink-muted italic">ไม่มีรายละเอียด</span>}
                  </p>

                  {/* Footer metadata & actions */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <Badge variant="neutral">{tx.category}</Badge>
                      <Badge variant="neutral">{tx.account}</Badge>
                      {isBalanceAdjustment(tx) && (
                        <Badge
                          variant="accent"
                          title="รายการปรับให้ยอดตรงกับธนาคาร ไม่นับเป็นรายรับ/รายจ่าย (ลบได้)"
                        >
                          ปรับยอด
                        </Badge>
                      )}
                      {isManual && <Badge variant="accent">บันทึกเอง</Badge>}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {slipLink && (
                        <a
                          href={slipLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 min-h-10 px-2.5 rounded-control bg-accent-soft text-accent-text border border-accent-border text-xs font-medium"
                        >
                          <span>สลิป</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}

                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleOpenEdit(tx)}
                        title={isManual ? 'แก้ไขรายการ' : 'เพิ่มรายละเอียดเพิ่มเติม'}
                        aria-label={isManual ? 'แก้ไขรายการ' : 'เพิ่มรายละเอียดเพิ่มเติม'}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>

                      {isManual && (
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDeleteTx(tx);
                          }}
                          disabled={isDeleting}
                          title="ลบรายการ"
                          aria-label="ลบรายการ"
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

        {/* 2. Desktop Bank-Statement Table View (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead className="bg-surface-subtle text-ink-secondary font-medium text-xs border-b border-border">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">วัน-เวลา</th>
                <th className="px-4 py-3 whitespace-nowrap">ประเภท</th>
                <th className="px-4 py-3 whitespace-nowrap">หมวดหมู่</th>
                <th className="px-4 py-3 whitespace-nowrap">บัญชี</th>
                <th className="px-4 py-3">รายละเอียด / หมายเหตุ</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">จำนวนเงิน</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">สลิป</th>
                <th className="px-3 py-3 text-center whitespace-nowrap w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-ink">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-xs">
                    กำลังโหลดข้อมูลรายการ...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-xs">
                    ไม่พบรายการที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                paginatedTransactions.map((tx, idx) => {
                  const meta = getTypeMeta(tx.type);
                  const isManual = tx.source === 'MANUAL';
                  const isDeleting = deletingId === tx.id;
                  const slipLink = resolveSlipLink(tx);

                  return (
                    <tr
                      key={`${tx.id || 'row'}-${idx}`}
                      className="hover:bg-surface-subtle/50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-ink-muted text-xs tabular-nums">
                        <div>{tx.date}</div>
                        {tx.time && <div className="text-[11px]">{tx.time}</div>}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-xs font-medium text-ink">
                        <div className="flex items-center gap-1.5">
                          <span>{tx.category}</span>
                          {isBalanceAdjustment(tx) && (
                            <Badge
                              variant="accent"
                              title="รายการปรับให้ยอดตรงกับธนาคาร ไม่นับเป็นรายรับ/รายจ่าย (ลบได้)"
                            >
                              ปรับยอด
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant="neutral">{tx.account}</Badge>
                      </td>

                      <td className="px-4 py-3 max-w-xs text-xs text-ink-secondary">
                        <span className="truncate block" title={tx.note || 'ไม่มีรายละเอียด'}>
                          {tx.note || <span className="text-ink-muted italic">ไม่มีรายละเอียด</span>}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-xs sm:text-sm tabular-nums">
                        <span className={meta.amountClass}>
                          {meta.prefix}฿{formatMoney(tx.amount)}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {slipLink ? (
                          <a
                            href={slipLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline font-medium"
                          >
                            <span>สลิป</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-ink-muted text-xs">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(tx)}
                            title={isManual ? 'แก้ไขรายการนี้' : 'เพิ่มรายละเอียดเพิ่มเติม'}
                            aria-label={isManual ? 'แก้ไขรายการนี้' : 'เพิ่มรายละเอียดเพิ่มเติม'}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>

                          {isManual && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setDeleteError(null);
                                setPendingDeleteTx(tx);
                              }}
                              disabled={isDeleting}
                              title="ลบรายการที่บันทึกเอง"
                              aria-label="ลบรายการที่บันทึกเอง"
                              className="hover:text-expense hover:bg-expense-soft"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3.5 border-t border-border bg-surface-subtle/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-muted">
          <div className="tabular-nums">
            {filtered.length > 0 ? (
              <span>
                แสดง <strong className="text-ink font-semibold">{startIndex + 1} - {endIndex}</strong> จาก{' '}
                <strong className="text-ink font-semibold">{filtered.length.toLocaleString('th-TH')}</strong> รายการ
              </span>
            ) : (
              <span>0 รายการ</span>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage === 1}
                title="หน้าแรกสุด"
                aria-label="หน้าแรกสุด"
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={safeCurrentPage === 1}
                title="หน้าก่อนหน้า"
                aria-label="หน้าก่อนหน้า"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <div className="px-3 py-1.5 bg-surface border border-border rounded-control text-xs font-medium text-ink tabular-nums">
                หน้า <span className="font-semibold text-accent-text">{safeCurrentPage}</span> / {totalPages}
              </div>

              <Button
                variant="secondary"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={safeCurrentPage === totalPages}
                title="หน้าถัดไป"
                aria-label="หน้าถัดไป"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage === totalPages}
                title="หน้าสุดท้าย"
                aria-label="หน้าสุดท้าย"
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Full Edit Modal for MANUAL Transactions */}
      <Modal
        isOpen={Boolean(editingManualTx)}
        onClose={closeManualEdit}
        title="แก้ไขรายการที่บันทึกเอง"
        description="แก้ไขข้อมูลได้ครบทุกช่อง และอัปเดตลง Google Sheet"
        size="md"
        disableClose={isSavingManual}
      >
        <form onSubmit={handleSaveManual} className="space-y-4">
          {manualError && <Alert variant="error">{manualError}</Alert>}

          {/* Type Switcher */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-surface-subtle rounded-control border border-border">
            {(['EXPENSE', 'INCOME', 'TRANSFER'] as TransactionType[]).map((t) => {
              const active = manualType === t;
              const activeClass =
                t === 'EXPENSE'
                  ? 'bg-expense-soft text-expense border-expense-border'
                  : t === 'INCOME'
                  ? 'bg-income-soft text-income border-income-border'
                  : 'bg-transfer-soft text-transfer border-transfer-border';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setManualType(t)}
                  aria-pressed={active}
                  className={`min-h-9 py-1.5 text-xs font-semibold rounded-badge border transition-colors cursor-pointer ${
                    active
                      ? activeClass
                      : 'border-transparent text-ink-secondary hover:text-ink'
                  }`}
                >
                  {t === 'EXPENSE' ? 'รายจ่าย' : t === 'INCOME' ? 'รายรับ' : 'โอนย้าย'}
                </button>
              );
            })}
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="edit-manual-amount">จำนวนเงิน (บาท)</Label>
            <Input
              id="edit-manual-amount"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              className="text-lg font-semibold tabular-nums"
            />
          </div>

          {/* Category & Account */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-manual-category">หมวดหมู่</Label>
              <Select
                id="edit-manual-category"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-manual-account">บัญชี</Label>
              <Select
                id="edit-manual-account"
                value={manualAccount}
                onChange={(e) => setManualAccount(e.target.value)}
              >
                <option value="K PLUS">K PLUS</option>
                <option value="Make by KBank">Make by KBank</option>
                <option value="เป๋าตัง">เป๋าตัง (Paotang)</option>
                <option value="เงินสด">เงินสด</option>
                <option value="อื่นๆ">อื่นๆ</option>
              </Select>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-manual-date">วันที่</Label>
              <Input
                id="edit-manual-date"
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="edit-manual-time">เวลา</Label>
              <Input
                id="edit-manual-time"
                type="time"
                step="1"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <Label htmlFor="edit-manual-note">รายละเอียด / หมายเหตุ</Label>
            <Textarea
              id="edit-manual-note"
              rows={3}
              placeholder="เช่น ข้าวกลางวัน, ค่ากาแฟ, รายการสิ่งของที่ซื้อ"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
            />
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={closeManualEdit}>
              ยกเลิก
            </Button>
            <Button type="submit" variant="primary" disabled={isSavingManual}>
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingManual ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Quick Edit Note Modal for AUTO_SYNC Transactions */}
      <Modal
        isOpen={Boolean(editingNoteTx)}
        onClose={closeNoteEdit}
        title="เพิ่ม/แก้ไขรายละเอียดเพิ่มเติม"
        description={
          editingNoteTx
            ? `${editingNoteTx.date} ${editingNoteTx.time} · ฿${formatMoney(editingNoteTx.amount)} (${editingNoteTx.category})`
            : undefined
        }
        size="lg"
        disableClose={isSavingNote}
      >
        <form onSubmit={handleSaveNote} className="space-y-4">
          {noteError && <Alert variant="error">{noteError}</Alert>}

          {editingNoteTx?.category === PENDING_CATEGORY && (
            <div>
              <Label htmlFor="edit-note-category">หมวดหมู่</Label>
              <Select
                id="edit-note-category"
                value={editNoteCategory}
                onChange={(e) => setEditNoteCategory(e.target.value)}
              >
                <option value="">{PENDING_CATEGORY}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="edit-note-text">
              คำอธิบาย / รายการสิ่งของที่ซื้อ (เช่น ซื้อของแม็คโคร: หมู 2 กก, ไข่ไก่, นมสด)
            </Label>
            <Textarea
              id="edit-note-text"
              rows={4}
              required
              placeholder="พิมพ์รายละเอียดเพิ่มเติมเกี่ยวกับรายการนี้..."
              value={editNoteText}
              onChange={(e) => setEditNoteText(e.target.value)}
            />
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={closeNoteEdit}>
              ยกเลิก
            </Button>
            <Button type="submit" variant="primary" disabled={isSavingNote}>
              <Check className="w-3.5 h-3.5" />
              <span>{isSavingNote ? 'กำลังบันทึกลง Sheet...' : 'บันทึกคำอธิบาย'}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Manual Transaction Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(pendingDeleteTx)}
        onClose={() => {
          setPendingDeleteTx(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
        title="ยืนยันการลบรายการ"
        description={
          pendingDeleteTx
            ? `คุณต้องการลบรายการที่บันทึกเอง "${pendingDeleteTx.note || pendingDeleteTx.category}" จำนวน ฿${formatMoney(pendingDeleteTx.amount)} ใช่หรือไม่?`
            : ''
        }
        error={deleteError}
        confirmLabel="ลบรายการ"
        cancelLabel="ยกเลิก"
        variant="destructive"
        loading={deletingId !== null}
        modalId="delete-tx-confirm"
      />

      {/* Deduplicate Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDedupeOpen}
        onClose={() => {
          setConfirmDedupeOpen(false);
          setDedupeError(null);
        }}
        onConfirm={handleConfirmDeduplicate}
        title="ยืนยันการลบรายการซ้ำ"
        description="คุณต้องการตรวจสอบและลบรายการที่ซ้ำกันใน Google Sheets ทั้งหมดใช่หรือไม่?"
        error={dedupeError}
        confirmLabel="ยืนยันลบรายการซ้ำ"
        cancelLabel="ยกเลิก"
        variant="primary"
        loading={isDeduplicating}
        modalId="dedupe-tx-confirm"
      />
    </>
  );
}
