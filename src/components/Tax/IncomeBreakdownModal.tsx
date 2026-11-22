'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  CheckCircle2,
  Ban,
  CircleDot,
  Calendar,
  Wallet,
  Tag,
  Info,
} from 'lucide-react';
import type { IncomeBySection, TaxBreakdownTransaction } from '@/lib/tax/tax-types';
import {
  SECTION_CODE_MAP,
  formatThaiDate,
  isTransactionExcluded,
  getTransactionStatusInfo,
} from '@/lib/tax/tax-breakdown-helpers';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { Badge, Button, Input, Modal } from '@/components/ui';

export interface IncomeBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  sectionKey: keyof IncomeBySection | 'exempt' | null;
  sectionTitle: string;
  transactions: TaxBreakdownTransaction[];
  excludedIds: Set<string>;
  onToggleExclude: (txId: string) => void;
}

const formatMoney = (amount: number) =>
  amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IncomeBreakdownModal({
  isOpen,
  onClose,
  sectionKey,
  sectionTitle,
  transactions,
  excludedIds,
  onToggleExclude,
}: IncomeBreakdownModalProps) {
  const { closeModal } = useHistoryModal({
    isOpen,
    onClose,
    modalId: 'income-breakdown-modal',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'ALL' | 'TAXABLE' | 'EXEMPT'>('ALL');
  const [prevSectionKey, setPrevSectionKey] = useState(sectionKey);

  // Reset search and filter when section changes without triggering an effect
  if (sectionKey !== prevSectionKey) {
    setPrevSectionKey(sectionKey);
    setSearchTerm('');
    setFilterTab('ALL');
  }

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const { grossTotal, taxableAmount, excludedAmount, taxableCount, excludedCount } =
    useMemo(() => {
      let gross = 0;
      let taxable = 0;
      let excluded = 0;
      let tCount = 0;
      let eCount = 0;

      for (const tx of transactions) {
        const amt = Number(tx.amount) || 0;
        gross += amt;
        const isExcluded = isTransactionExcluded(tx, excludedIds);
        if (isExcluded) {
          excluded += amt;
          eCount += 1;
        } else {
          taxable += amt;
          tCount += 1;
        }
      }

      return {
        grossTotal: gross,
        taxableAmount: taxable,
        excludedAmount: excluded,
        taxableCount: tCount,
        excludedCount: eCount,
      };
    }, [transactions, excludedIds]);

  const filteredTransactions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return transactions.filter((tx) => {
      if (q) {
        const note = (tx.note || '').toLowerCase();
        const category = (tx.category || '').toLowerCase();
        const account = (tx.account || '').toLowerCase();
        const amountStr = (tx.amount || 0).toString();
        const matchesSearch =
          note.includes(q) ||
          category.includes(q) ||
          account.includes(q) ||
          amountStr.includes(q);
        if (!matchesSearch) return false;
      }

      const isExcluded = isTransactionExcluded(tx, excludedIds);
      const isTaxable = !isExcluded;

      if (filterTab === 'TAXABLE') return isTaxable;
      if (filterTab === 'EXEMPT') return isExcluded;
      return true;
    });
  }, [transactions, searchTerm, filterTab, excludedIds]);

  const isExemptSection = sectionKey === 'exempt';
  const sectionBadge = isExemptSection
    ? 'ยกเว้นภาษี'
    : sectionKey && SECTION_CODE_MAP[sectionKey]
    ? SECTION_CODE_MAP[sectionKey]
    : 'มาตรา 40';

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title={sectionTitle}
      description="รายการธุรกรรมที่เชื่อมโยงกับหมวดนี้ สามารถเปิดหรือปิดเพื่อรวมหรือยกเว้นจากการคำนวณภาษีได้"
      badge={
        <div className="flex items-center gap-1.5">
          <Badge variant={isExemptSection ? 'expense' : 'accent'}>{sectionBadge}</Badge>
          <Badge variant="neutral" className="tabular-nums">
            {transactions.length} รายการ
          </Badge>
        </div>
      }
      size="xl"
      footer={
        <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <Info className="w-4 h-4 shrink-0" />
            <span>การเปิดหรือปิดรายการจะอัปเดตยอดคำนวณภาษีและเงินได้พึงประเมินโดยอัตโนมัติ</span>
          </div>
          <Button variant="secondary" onClick={closeModal} className="shrink-0">
            ปิดหน้าต่าง
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Real-time Summary KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="p-3 rounded-control bg-surface-subtle/50 border border-border flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] text-ink-muted block">ยอดรวมทั้งหมด</span>
              <span className="text-base font-semibold text-ink tabular-nums">
                ฿{formatMoney(grossTotal)}
              </span>
            </div>
            <Badge variant="neutral" className="tabular-nums">
              {transactions.length} รายการ
            </Badge>
          </div>

          <div className="p-3 rounded-control bg-income-soft/60 border border-income-border flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] text-income font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                รวมในภาษี
              </span>
              <span className="text-base font-semibold text-income tabular-nums">
                ฿{formatMoney(taxableAmount)}
              </span>
            </div>
            <Badge variant="income" className="tabular-nums">
              {taxableCount} รายการ
            </Badge>
          </div>

          <div className="p-3 rounded-control bg-surface-subtle/50 border border-border flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] text-ink-muted font-medium flex items-center gap-1">
                <Ban className="w-3.5 h-3.5" />
                ยกเว้นภาษี
              </span>
              <span className="text-base font-semibold text-ink-secondary tabular-nums">
                ฿{formatMoney(excludedAmount)}
              </span>
            </div>
            <Badge variant="neutral" className="tabular-nums">
              {excludedCount} รายการ
            </Badge>
          </div>
        </div>

        {/* Search & Filter Chips */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              aria-label="ค้นหารายการในหมวดนี้"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาตามบันทึก หมวดหมู่ หรือบัญชี..."
              className="pl-9 pr-9 text-xs sm:text-sm"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink-muted hover:text-ink cursor-pointer"
                aria-label="ล้างคำค้นหา"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-control border border-border shrink-0 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setFilterTab('ALL')}
              aria-pressed={filterTab === 'ALL'}
              className={`min-h-8 px-3 py-1 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                filterTab === 'ALL'
                  ? 'bg-surface text-accent-text font-semibold border border-border shadow-card'
                  : 'text-ink-secondary hover:text-ink border border-transparent'
              }`}
            >
              ทั้งหมด ({transactions.length})
            </button>

            <button
              type="button"
              onClick={() => setFilterTab('TAXABLE')}
              aria-pressed={filterTab === 'TAXABLE'}
              className={`min-h-8 px-3 py-1 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                filterTab === 'TAXABLE'
                  ? 'bg-income-soft text-income font-semibold border border-income-border'
                  : 'text-ink-secondary hover:text-ink border border-transparent'
              }`}
            >
              รวมในภาษี ({taxableCount})
            </button>

            <button
              type="button"
              onClick={() => setFilterTab('EXEMPT')}
              aria-pressed={filterTab === 'EXEMPT'}
              className={`min-h-8 px-3 py-1 rounded-badge text-xs font-medium whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                filterTab === 'EXEMPT'
                  ? 'bg-surface text-ink font-semibold border border-border shadow-card'
                  : 'text-ink-secondary hover:text-ink border border-transparent'
              }`}
            >
              ยกเว้นภาษี ({excludedCount})
            </button>
          </div>
        </div>

        {/* Transaction List */}
        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center space-y-2 border border-border rounded-control bg-surface-subtle/30">
            <Search className="w-6 h-6 text-ink-muted mx-auto opacity-50" />
            <p className="text-sm font-medium text-ink">
              {transactions.length === 0
                ? 'ไม่มีรายการธุรกรรมในหมวดนี้'
                : `ไม่พบรายการที่ตรงกับ "${searchTerm}"`}
            </p>
            <p className="text-xs text-ink-muted max-w-sm mx-auto">
              {transactions.length === 0
                ? 'ระบบไม่พบธุรกรรมรายรับที่เชื่อมโยงกับหมวดนี้ในปีภาษีที่เลือก'
                : 'ลองปรับเปลี่ยนคำค้นหาหรือตัวกรองด้านบนเพื่อค้นหารายการ'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredTransactions.map((tx, idx) => {
              const isExcluded = isTransactionExcluded(tx, excludedIds);
              const isTaxable = !isExcluded;
              const statusInfo = getTransactionStatusInfo(tx, isExcluded);

              return (
                <div
                  key={tx.id || `tx-${idx}`}
                  className={`rounded-control p-3.5 border transition-colors ${
                    isTaxable
                      ? 'bg-surface border-border'
                      : 'bg-surface-subtle/50 border-border opacity-80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1 font-medium text-ink-secondary tabular-nums">
                          <Calendar className="w-3.5 h-3.5 text-ink-muted" />
                          <span>{formatThaiDate(tx.date)}</span>
                          {tx.time && <span className="text-ink-muted">({tx.time})</span>}
                        </span>

                        {tx.account && (
                          <Badge variant="neutral">
                            <Wallet className="w-3 h-3" />
                            <span>{tx.account}</span>
                          </Badge>
                        )}

                        <Badge variant="neutral">
                          <Tag className="w-3 h-3" />
                          <span>{tx.category}</span>
                        </Badge>
                      </div>

                      <p className="text-sm font-medium text-ink">
                        {tx.note || <span className="text-ink-muted font-normal">ไม่มีบันทึกรายละเอียด</span>}
                      </p>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {statusInfo.statusType === 'taxable' && (
                          <Badge variant="income">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>รวมในภาษี</span>
                          </Badge>
                        )}

                        {statusInfo.statusType === 'auto-exempt' && (
                          <>
                            <Badge variant="expense">
                              <Ban className="w-3 h-3" />
                              <span>ยกเว้นอัตโนมัติ</span>
                            </Badge>
                            {statusInfo.reasonLabel && (
                              <Badge variant="warning">{statusInfo.reasonLabel}</Badge>
                            )}
                          </>
                        )}

                        {statusInfo.statusType === 'user-excluded' && (
                          <Badge variant="neutral">
                            <CircleDot className="w-3 h-3" />
                            <span>ยกเว้นโดยผู้ใช้</span>
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-border shrink-0">
                      <span
                        className={`text-base font-semibold tabular-nums ${
                          isTaxable ? 'text-income' : 'text-ink-muted line-through'
                        }`}
                      >
                        +฿{formatMoney(Number(tx.amount) || 0)}
                      </span>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-ink-muted">
                          {isTaxable ? 'รวมภาษี' : 'ยกเว้น'}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isTaxable}
                          aria-label={`${isTaxable ? 'ยกเว้น' : 'รวม'}รายการ ${tx.note || tx.category} ในการคำนวณภาษี`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (tx.id) onToggleExclude(tx.id);
                          }}
                          disabled={!tx.id || tx.isExempt}
                          title={
                            !tx.id
                              ? 'ไม่มี Transaction ID ไม่สามารถสลับสถานะได้'
                              : tx.isExempt
                              ? 'รายการยกเว้นตามกฎหมาย (ไม่นำมารวมเป็นฐานภาษี)'
                              : isTaxable
                              ? 'คลิกเพื่อยกเว้นรายการนี้จากการคำนวณภาษี'
                              : 'คลิกเพื่อรวมรายการนี้ในการคำนวณภาษี'
                          }
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                            isTaxable ? 'bg-accent' : 'bg-border-strong'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-150 ${
                              isTaxable ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
