'use client';

import { useState, useRef } from 'react';
import { Plus, X, Upload, RefreshCw, ArrowRight, Image as ImageIcon } from 'lucide-react';
import { TransactionType } from '@/types';
import { getBangkokDateString, getBangkokTimeString } from '@/lib/utils/date';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';
import { Alert, Button, Input, Label, Modal, Select } from '@/components/ui';

interface ManualTransactionModalProps {
  onSuccess: () => void;
  isMobileFab?: boolean;
}

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

const ACCOUNTS = [
  { id: 'เงินสด', label: 'เงินสด (Cash Wallet)', short: 'เงินสด' },
  { id: 'K PLUS', label: 'K PLUS (กสิกร)', short: 'K PLUS' },
  { id: 'Make by KBank', label: 'Make by KBank', short: 'Make' },
  { id: 'เป๋าตัง', label: 'เป๋าตัง (Paotang)', short: 'เป๋าตัง' },
  { id: 'อื่นๆ', label: 'อื่นๆ', short: 'อื่นๆ' },
];

const TRANSFER_PRESETS = [
  { from: 'เงินสด', to: 'K PLUS', fromLabel: 'เงินสด', toLabel: 'K PLUS', note: 'ฝากเงินสดเข้ากสิกร' },
  { from: 'เงินสด', to: 'Make by KBank', fromLabel: 'เงินสด', toLabel: 'Make', note: 'ฝากเงินสดเข้า Make' },
  { from: 'K PLUS', to: 'เงินสด', fromLabel: 'ถอน ATM', toLabel: 'เงินสด', note: 'ถอนเงินสด ATM' },
  { from: 'K PLUS', to: 'Make by KBank', fromLabel: 'K PLUS', toLabel: 'Make', note: 'โอนเข้า Make' },
];

export default function ManualTransactionModal({
  onSuccess,
  isMobileFab = false,
}: ManualTransactionModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { closeModal } = useHistoryModal({
    isOpen,
    onClose: () => setIsOpen(false),
    modalId: 'manual-tx-modal',
    enableEsc: !loading,
  });
  const [uploadingSlip, setUploadingSlip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [account, setAccount] = useState('K PLUS');
  const [fromAccount, setFromAccount] = useState('เงินสด');
  const [toAccount, setToAccount] = useState('K PLUS');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => getBangkokDateString());
  const [time, setTime] = useState(() => getBangkokTimeString());

  const applyTransferPreset = (from: string, to: string, defaultNote = '') => {
    setType('TRANSFER');
    setFromAccount(from);
    setToAccount(to);
    if (!note) setNote(defaultNote);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingSlip(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/slips/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to upload slip');

      const slip = data.slip;
      if (slip) {
        if (slip.amount) setAmount(String(slip.amount));
        if (slip.date) setDate(slip.date);
        if (slip.time) setTime(slip.time);
        if (slip.type) setType(slip.type);
        if (slip.category) setCategory(slip.category);
        if (slip.note) setNote(slip.note);
        if (slip.slipUrl) setSlipUrl(slip.slipUrl);
        if (slip.driveFileId) setDriveFileId(slip.driveFileId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ');
    } finally {
      setUploadingSlip(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const isTransfer = type === 'TRANSFER';
      const actualAccount = isTransfer ? fromAccount : account;
      const actualCategory = isTransfer ? 'โอนระหว่างบัญชี' : category;
      const actualNote = isTransfer
        ? note.trim()
          ? `โอนจาก ${fromAccount} ไปยัง ${toAccount} (${note.trim()})`
          : `โอนจาก ${fromAccount} ไปยัง ${toAccount}`
        : note.trim();

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amount: parseFloat(amount),
          category: actualCategory,
          account: actualAccount,
          note: actualNote,
          date,
          time,
          slipUrl: slipUrl || undefined,
          driveFileId: driveFileId || undefined,
        }),
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record transaction');
      }

      closeModal();
      setAmount('');
      setNote('');
      setSlipUrl(null);
      setDriveFileId(null);
      setTime(getBangkokTimeString());
      setDate(getBangkokDateString());
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {isMobileFab ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-10 h-10 rounded-control bg-accent hover:bg-accent-hover text-accent-fg flex items-center justify-center transition-colors cursor-pointer"
          title="บันทึกรายการเอง"
          aria-label="บันทึกรายการเอง"
        >
          <Plus className="w-5 h-5" />
        </button>
      ) : (
        <Button variant="primary" size="md" onClick={() => setIsOpen(true)}>
          <Plus className="w-4 h-4" />
          <span>บันทึกรายการเอง</span>
        </Button>
      )}

      <Modal
        isOpen={isOpen}
        onClose={closeModal}
        title={type === 'TRANSFER' ? 'โอนย้ายเงิน / จัดการเงินสด' : 'บันทึกรายการใหม่'}
        size="md"
        disableClose={loading}
      >
        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Switcher */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-surface-subtle rounded-control border border-border">
            {(['EXPENSE', 'INCOME', 'TRANSFER'] as TransactionType[]).map((t) => {
              const active = type === t;
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
                  onClick={() => setType(t)}
                  aria-pressed={active}
                  className={`min-h-9 py-1.5 text-xs font-semibold rounded-badge border transition-colors cursor-pointer ${
                    active ? activeClass : 'border-transparent text-ink-secondary hover:text-ink'
                  }`}
                >
                  {t === 'EXPENSE' ? 'รายจ่าย' : t === 'INCOME' ? 'รายรับ' : 'โอนย้าย / เงินสด'}
                </button>
              );
            })}
          </div>

          {/* Quick Transfer Presets */}
          {type === 'TRANSFER' && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-ink-secondary block">ทางลัดการย้ายเงิน</span>
              <div className="grid grid-cols-2 gap-2">
                {TRANSFER_PRESETS.map((preset) => {
                  const selected = fromAccount === preset.from && toAccount === preset.to;
                  return (
                    <button
                      key={`${preset.from}-${preset.to}`}
                      type="button"
                      onClick={() => applyTransferPreset(preset.from, preset.to, preset.note)}
                      className={`min-h-9 px-3 py-1.5 text-xs font-medium rounded-control border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-accent-soft text-accent-text border-accent-border font-semibold'
                          : 'bg-surface-subtle/50 text-ink-secondary border-border hover:bg-surface-subtle hover:text-ink'
                      }`}
                    >
                      <span className="truncate">{preset.fromLabel}</span>
                      <ArrowRight className="w-3 h-3 shrink-0" />
                      <span className="truncate">{preset.toLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Slip Upload & OCR */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            {slipUrl ? (
              <div className="flex items-center justify-between gap-2 p-3 bg-income-soft border border-income-border rounded-control text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <ImageIcon className="w-4 h-4 text-income shrink-0" />
                  <span className="text-income font-medium truncate">แนบรูปสลิปเรียบร้อยแล้ว</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={slipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-accent-text hover:underline px-2 py-1 rounded-badge"
                  >
                    ดูรูป
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setSlipUrl(null);
                      setDriveFileId(null);
                    }}
                    className="inline-flex items-center justify-center w-7 h-7 text-ink-muted hover:text-expense rounded-badge cursor-pointer"
                    title="ลบรูปสลิป"
                    aria-label="ลบรูปสลิป"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploadingSlip}
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-10 flex items-center justify-center gap-2 py-2.5 px-3 border border-dashed border-border-strong hover:border-accent-text rounded-control bg-surface-subtle/50 text-xs font-medium text-ink-secondary hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploadingSlip ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-accent-text" />
                    <span>กำลังอัปโหลดและประมวลผลสลิปด้วย AI...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 text-accent-text" />
                    <span>อัปโหลดสลิป (ให้ AI ช่วยเติมข้อมูลอัตโนมัติ)</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="manual-tx-amount">จำนวนเงิน (บาท)</Label>
            <Input
              id="manual-tx-amount"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-xl font-semibold tabular-nums py-2.5"
            />
          </div>

          {/* Dynamic Account Fields */}
          {type === 'TRANSFER' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-transfer-soft/60 rounded-control border border-transfer-border">
              <div>
                <Label htmlFor="manual-tx-from" className="text-ink">
                  จากบัญชีต้นทาง (หักเงิน)
                </Label>
                <Select
                  id="manual-tx-from"
                  value={fromAccount}
                  onChange={(e) => setFromAccount(e.target.value)}
                >
                  {ACCOUNTS.map((acc) => (
                    <option key={`from-${acc.id}`} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="manual-tx-to" className="text-ink">
                  ไปยังบัญชีปลายทาง (เพิ่มเงิน)
                </Label>
                <Select
                  id="manual-tx-to"
                  value={toAccount}
                  onChange={(e) => setToAccount(e.target.value)}
                >
                  {ACCOUNTS.map((acc) => (
                    <option key={`to-${acc.id}`} value={acc.id} disabled={acc.id === fromAccount}>
                      {acc.label} {acc.id === fromAccount ? '(ต้นทาง)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="manual-tx-category">หมวดหมู่</Label>
                <Select
                  id="manual-tx-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="manual-tx-account">บัญชี / กระเป๋าเงิน</Label>
                <Select
                  id="manual-tx-account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {ACCOUNTS.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="manual-tx-date">วันที่</Label>
              <Input
                id="manual-tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="manual-tx-time">เวลา (ปรับได้ก่อนบันทึก)</Label>
              <Input
                id="manual-tx-time"
                type="time"
                step="1"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <Label htmlFor="manual-tx-note">
              รายละเอียด / หมายเหตุ {type === 'TRANSFER' && '(ระบุเพิ่มเติมได้)'}
            </Label>
            <Input
              id="manual-tx-note"
              type="text"
              placeholder={
                type === 'TRANSFER'
                  ? 'เช่น ฝากเงินสดเข้าบัญชีที่ตู้ CDM, คืนเงินสด'
                  : 'เช่น ข้าวกลางวัน, ค่ากาแฟ'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={closeModal}>
              ยกเลิก
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading
                ? 'กำลังบันทึก...'
                : type === 'TRANSFER'
                ? 'บันทึกการโอนย้าย'
                : 'บันทึกลง Google Sheet'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
