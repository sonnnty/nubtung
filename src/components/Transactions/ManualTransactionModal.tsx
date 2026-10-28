'use client';

import { useState, useRef } from 'react';
import { Plus, X, Upload, RefreshCw } from 'lucide-react';
import { TransactionType } from '@/types';
import { getBangkokDateString, getBangkokTimeString } from '@/lib/utils/date';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';

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

export default function ManualTransactionModal({ onSuccess, isMobileFab = false }: ManualTransactionModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { closeModal } = useHistoryModal({
    isOpen,
    onClose: () => setIsOpen(false),
    modalId: 'manual-tx-modal',
  });
  const [loading, setLoading] = useState(false);
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

  const ACCOUNTS = [
    { id: 'เงินสด', label: '💵 เงินสด (Cash Wallet)', short: 'เงินสด' },
    { id: 'K PLUS', label: '🔵 K PLUS (กสิกร)', short: 'K PLUS' },
    { id: 'Make by KBank', label: '🟡 Make by KBank', short: 'Make' },
    { id: 'เป๋าตัง', label: '📲 เป๋าตัง (Paotang)', short: 'เป๋าตัง' },
    { id: 'อื่นๆ', label: 'อื่นๆ', short: 'อื่นๆ' },
  ];

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
    } catch (err: any) {
      setError(err.message || 'อัปโหลดสลิปไม่สำเร็จ');
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
    } catch (err: any) {
      setError(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {isMobileFab ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 active:scale-95 transition-transform"
          title="บันทึกรายการเอง"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>บันทึกรายการเอง</span>
        </button>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
          onClick={closeModal}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto overscroll-contain p-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 relative transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              {type === 'TRANSFER' ? '🔄 โอนย้ายเงิน / จัดการเงินสด' : 'บันทึกรายการใหม่'}
            </h2>

            {error && (
              <div className="mb-4 p-3 rounded-2xl bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-xs border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              {/* Type Switcher */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                {(['EXPENSE', 'INCOME', 'TRANSFER'] as TransactionType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`py-2 text-xs font-bold rounded-xl transition-all ${
                      type === t
                        ? t === 'EXPENSE'
                          ? 'bg-rose-500 text-white shadow-sm'
                          : t === 'INCOME'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-amber-500 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t === 'EXPENSE' ? '🔴 รายจ่าย' : t === 'INCOME' ? '🟢 รายรับ' : '🔄 โอนย้าย / เงินสด'}
                  </button>
                ))}
              </div>

              {/* Quick Transfer Presets (shown only when type is TRANSFER) */}
              {type === 'TRANSFER' && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    ทางลัดการย้ายเงิน:
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyTransferPreset('เงินสด', 'K PLUS', 'ฝากเงินสดเข้ากสิกร')}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-xl border text-left transition-all ${
                        fromAccount === 'เงินสด' && toAccount === 'K PLUS'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      💵 เงินสด ➔ 🔵 K PLUS
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTransferPreset('เงินสด', 'Make by KBank', 'ฝากเงินสดเข้า Make')}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-xl border text-left transition-all ${
                        fromAccount === 'เงินสด' && toAccount === 'Make by KBank'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      💵 เงินสด ➔ 🟡 Make
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTransferPreset('K PLUS', 'เงินสด', 'ถอนเงินสด ATM')}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-xl border text-left transition-all ${
                        fromAccount === 'K PLUS' && toAccount === 'เงินสด'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      🏧 ถอน ATM ➔ 💵 เงินสด
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTransferPreset('K PLUS', 'Make by KBank', 'โอนเข้า Make')}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-xl border text-left transition-all ${
                        fromAccount === 'K PLUS' && toAccount === 'Make by KBank'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      🔄 K PLUS ➔ 🟡 Make
                    </button>
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
                  <div className="flex items-center justify-between p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-base">🖼️</span>
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium truncate">แนบรูปสลิปเรียบร้อยแล้ว</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={slipUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline px-2 py-1 rounded-lg hover:bg-emerald-100/50"
                      >
                        ดูรูป
                      </a>
                      <button
                        type="button"
                        onClick={() => { setSlipUrl(null); setDriveFileId(null); }}
                        className="p-1 text-slate-400 hover:text-red-500 rounded-lg"
                        title="ลบรูปสลิป"
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
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl bg-slate-50/60 dark:bg-slate-800/40 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all disabled:opacity-50"
                  >
                    {uploadingSlip ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                        <span>กำลังอัปโหลดและประมวลผลสลิปด้วย AI...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>📷 อัปโหลดสลิป (ให้ AI ช่วยเติมข้อมูลอัตโนมัติ)</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  จำนวนเงิน (บาท)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full text-xl font-bold px-3.5 py-3 bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>

              {/* Dynamic Account Fields based on Type */}
              {type === 'TRANSFER' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200/50 dark:border-amber-900/40">
                  <div>
                    <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">
                      📤 จากบัญชีต้นทาง (หักเงิน)
                    </label>
                    <select
                      value={fromAccount}
                      onChange={(e) => setFromAccount(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none font-medium"
                    >
                      {ACCOUNTS.map((acc) => (
                        <option key={`from-${acc.id}`} value={acc.id}>
                          {acc.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">
                      📥 ไปยังบัญชีปลายทาง (เพิ่มเงิน)
                    </label>
                    <select
                      value={toAccount}
                      onChange={(e) => setToAccount(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none font-medium"
                    >
                      {ACCOUNTS.map((acc) => (
                        <option key={`to-${acc.id}`} value={acc.id} disabled={acc.id === fromAccount}>
                          {acc.label} {acc.id === fromAccount ? '(ต้นทาง)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      หมวดหมู่
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat} className="dark:bg-slate-900 dark:text-white">
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      บัญชี / กระเป๋าเงิน
                    </label>
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none font-medium"
                    >
                      {ACCOUNTS.map((acc) => (
                        <option key={acc.id} value={acc.id} className="dark:bg-slate-900 dark:text-white">
                          {acc.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Date & Time */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    📅 วันที่
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    ⏰ เวลา (ปรับได้ก่อนบันทึก)
                  </label>
                  <input
                    type="time"
                    step="1"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  รายละเอียด / หมายเหตุ {type === 'TRANSFER' && '(ระบุเพิ่มเติมได้)'}
                </label>
                <input
                  type="text"
                  placeholder={type === 'TRANSFER' ? 'เช่น ฝากเงินสดเข้าบัญชีที่ตู้ CDM, คืนเงินสด' : 'เช่น ข้าวกลางวัน, ค่ากาแฟ'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-2xl shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
                >
                  {loading ? 'กำลังบันทึก...' : type === 'TRANSFER' ? '🔄 บันทึกการโอนย้าย' : 'บันทึกลง Google Sheet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
