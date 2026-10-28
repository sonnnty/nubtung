'use client';

import { useState } from 'react';
import { Plus, X, Building2, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';
import { getBangkokDateString } from '@/lib/utils/date';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';

interface ManualPaymentModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess: () => void;
  defaultAccountId?: string;
}

const ACCOUNTS = [
  { id: '011690010474', label: '🏠 สินเชื่อเพื่อที่อยู่อาศัย (บ้านหลัก)', amount: '2,100,000' },
  { id: '011690010482', label: '🛡️ สินเชื่อเบี้ยประกันชีวิตคุ้มครองวงเงิน (MRTA)', amount: '100,023' },
];

export default function ManualPaymentModal({
  isOpen = false,
  onClose,
  onSuccess,
  defaultAccountId = '011690010474',
}: ManualPaymentModalProps) {
  const { closeModal } = useHistoryModal({
    isOpen,
    onClose: () => {
      if (onClose) onClose();
    },
    modalId: 'mortgage-payment-modal',
  });

  const [accountId, setAccountId] = useState(defaultAccountId);
  const [paymentDate, setPaymentDate] = useState(() => getBangkokDateString());
  const [installmentNo, setInstallmentNo] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [fee, setFee] = useState('0');
  const [remainingBalance, setRemainingBalance] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync defaultAccountId when changed
  const [prevDefaultAccountId, setPrevDefaultAccountId] = useState(defaultAccountId);
  if (defaultAccountId !== prevDefaultAccountId) {
    setPrevDefaultAccountId(defaultAccountId);
    if (defaultAccountId && defaultAccountId !== 'ALL') {
      setAccountId(defaultAccountId);
    }
  }

  if (!isOpen) return null;

  // Auto-calculate helper: sum of parts
  const sumOfParts =
    (parseFloat(principal) || 0) + (parseFloat(interest) || 0) + (parseFloat(fee) || 0);
  const enteredTotal = parseFloat(totalPaid) || 0;
  const isMismatched = enteredTotal > 0 && Math.abs(enteredTotal - sumOfParts) > 0.05;

  const handleAutoFillTotal = () => {
    if (sumOfParts > 0) {
      setTotalPaid(sumOfParts.toFixed(2));
    }
  };

  const handleAutoCalculateInterest = () => {
    if (enteredTotal > 0) {
      const princ = parseFloat(principal) || 0;
      const f = parseFloat(fee) || 0;
      const calculatedInterest = Math.max(0, enteredTotal - princ - f);
      setInterest(calculatedInterest.toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const total = parseFloat(totalPaid);
      const princ = parseFloat(principal);
      const intr = parseFloat(interest);
      const feeVal = parseFloat(fee) || 0;

      if (!paymentDate) throw new Error('กรุณาระบุวันที่ชำระ');
      if (isNaN(total) || total <= 0) throw new Error('กรุณาระบุยอดชำระที่ถูกต้อง');
      if (isNaN(princ) || princ < 0) throw new Error('กรุณาระบุยอดเงินต้น');
      if (isNaN(intr) || intr < 0) throw new Error('กรุณาระบุดอกเบี้ย');
 
      const body: Record<string, unknown> = {
        accountId,
        paymentDate,
        totalPaid: total,
        principal: princ,
        interest: intr,
        fee: feeVal,
        source: 'MANUAL',
      };

      if (installmentNo && !isNaN(Number(installmentNo))) {
        body.installmentNo = parseInt(installmentNo, 10);
      }

      if (remainingBalance && !isNaN(parseFloat(remainingBalance))) {
        body.remainingBalance = parseFloat(remainingBalance);
      }

      const res = await fetch('/api/mortgage/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await readJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'บันทึกรายการไม่สำเร็จ');
      }

      // Reset form
      setTotalPaid('');
      setPrincipal('');
      setInterest('');
      setFee('0');
      setRemainingBalance('');
      setInstallmentNo('');

      onSuccess();
      closeModal();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
      onClick={closeModal}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto overscroll-contain p-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:p-7 shadow-2xl border border-slate-200 dark:border-slate-800 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={closeModal}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>บันทึกรายการผ่อนชำระด้วยตนเอง</span>
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            เพิ่มข้อมูลการจ่ายเงินตามใบเสร็จรับเงิน ธอส. (กรณีไม่ได้ส่งเข้าอีเมลอัตโนมัติ)
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-xs border border-red-200 dark:border-red-800 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Account Selector */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 dark:text-slate-300">
              บัญชีสินเชื่อที่ชำระ <span className="text-rose-500">*</span>
            </label>
            <div className="space-y-2">
              {ACCOUNTS.map((acc) => (
                <label
                  key={acc.id}
                  className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                    accountId === acc.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-semibold'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="accountId"
                      value={acc.id}
                      checked={accountId === acc.id}
                      onChange={() => setAccountId(acc.id)}
                      className="accent-emerald-600"
                    />
                    <span>{acc.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">วงเงิน ฿{acc.amount}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Date & Installment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                วันที่ชำระ <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                งวดที่ (Installment No.)
              </label>
              <input
                type="number"
                min={1}
                placeholder="เช่น 1, 2, 3..."
                value={installmentNo}
                onChange={(e) => setInstallmentNo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Payment Breakdown (Principal, Interest, Fee) */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                การแบ่งยอดชำระ (Breakdown)
              </span>
              {sumOfParts > 0 && (
                <button
                  type="button"
                  onClick={handleAutoFillTotal}
                  className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 hover:underline"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>ใช้ยอดรวม ฿{sumOfParts.toFixed(2)}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  เงินต้น (฿) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 text-slate-900 dark:text-white font-semibold focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 flex justify-between">
                  <span>ดอกเบี้ย (฿) *</span>
                  {enteredTotal > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoCalculateInterest}
                      className="text-[9px] underline text-amber-600"
                      title="คำนวณจาก ยอดรวม - เงินต้น"
                    >
                      เติมอัตโนมัติ
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/60 text-slate-900 dark:text-white font-semibold focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                  ค่าธรรมเนียม/ประกัน (฿)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800/60 text-slate-900 dark:text-white font-semibold focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Total Paid & Remaining Balance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                ยอดรวมที่ชำระจริง (Total Paid ฿) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={totalPaid}
                onChange={(e) => setTotalPaid(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border font-bold text-sm text-slate-900 dark:text-white focus:ring-1 ${
                  isMismatched
                    ? 'border-amber-400 dark:border-amber-600 focus:ring-amber-500'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-emerald-500'
                }`}
              />
              {isMismatched && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                  ⚠️ ผลรวมเงินต้น+ดอกเบี้ย+ประกัน ({sumOfParts.toFixed(2)}) ไม่ตรงกับยอดชำระรวม ({enteredTotal.toFixed(2)})
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                ยอดหนี้คงเหลือหลังชำระ (฿)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="เว้นว่างเพื่อให้ระบบคำนวณอัตโนมัติ"
                value={remainingBalance}
                onChange={(e) => setRemainingBalance(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500"
              />
              <p className="text-[10px] text-slate-400">
                หากเว้นว่าง ระบบจะคำนวณจากยอดหนี้เดิมหักด้วยเงินต้น
              </p>
            </div>
          </div>

          {/* Submit and Cancel Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังบันทึก...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>บันทึกรายการ</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
