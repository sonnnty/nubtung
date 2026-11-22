'use client';

import { useState } from 'react';
import { Plus, Loader2, AlertTriangle } from 'lucide-react';
import { getBangkokDateString } from '@/lib/utils/date';
import { useHistoryModal } from '@/lib/hooks/useHistoryModal';
import { readJson } from '@/lib/utils/http';
import { Alert, Button, Input, Label, Modal } from '@/components/ui';

interface ManualPaymentModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess: () => void;
  defaultAccountId?: string;
}

const ACCOUNTS = [
  { id: '011690010474', label: 'สินเชื่อเพื่อที่อยู่อาศัย (บ้านหลัก)', amount: '2,100,000' },
  { id: '011690010482', label: 'สินเชื่อเบี้ยประกันชีวิตคุ้มครองวงเงิน (MRTA)', amount: '100,023' },
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

  const [prevDefaultAccountId, setPrevDefaultAccountId] = useState(defaultAccountId);
  if (defaultAccountId !== prevDefaultAccountId) {
    setPrevDefaultAccountId(defaultAccountId);
    if (defaultAccountId && defaultAccountId !== 'ALL') {
      setAccountId(defaultAccountId);
    }
  }

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
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="บันทึกรายการผ่อนชำระด้วยตนเอง"
      description="เพิ่มข้อมูลการจ่ายเงินตามใบเสร็จรับเงิน ธอส. (กรณีไม่ได้ส่งเข้าอีเมลอัตโนมัติ)"
      size="lg"
    >
      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Account Selector */}
        <div className="space-y-2">
          <Label>
            บัญชีสินเชื่อที่ชำระ <span className="text-expense">*</span>
          </Label>
          <div className="space-y-2">
            {ACCOUNTS.map((acc) => {
              const checked = accountId === acc.id;
              return (
                <label
                  key={acc.id}
                  className={`flex items-center justify-between gap-2 p-3 rounded-control border cursor-pointer transition-colors text-xs ${
                    checked
                      ? 'bg-accent-soft border-accent-border text-ink font-semibold'
                      : 'bg-surface-subtle/40 border-border text-ink-secondary hover:bg-surface-subtle'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="radio"
                      name="accountId"
                      value={acc.id}
                      checked={checked}
                      onChange={() => setAccountId(acc.id)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="truncate">{acc.label}</span>
                  </div>
                  <span className="text-[11px] text-ink-muted shrink-0 tabular-nums">
                    วงเงิน ฿{acc.amount}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Date & Installment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mortgage-pay-date">
              วันที่ชำระ <span className="text-expense">*</span>
            </Label>
            <Input
              id="mortgage-pay-date"
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="tabular-nums"
            />
          </div>

          <div>
            <Label htmlFor="mortgage-installment-no">งวดที่ (Installment No.)</Label>
            <Input
              id="mortgage-installment-no"
              type="number"
              min={1}
              placeholder="เช่น 1, 2, 3..."
              value={installmentNo}
              onChange={(e) => setInstallmentNo(e.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>

        {/* Payment Breakdown */}
        <div className="p-3.5 rounded-control bg-surface-subtle/50 border border-border space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">การแบ่งยอดชำระ</span>
            {sumOfParts > 0 && (
              <button
                type="button"
                onClick={handleAutoFillTotal}
                className="text-xs text-accent-text font-medium hover:underline cursor-pointer tabular-nums"
              >
                ใช้ยอดรวม ฿{sumOfParts.toFixed(2)}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <Label htmlFor="mortgage-principal" className="text-income">
                เงินต้น (฿) *
              </Label>
              <Input
                id="mortgage-principal"
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="font-semibold tabular-nums"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="mortgage-interest" className="text-xs font-medium text-warning">
                  ดอกเบี้ย (฿) *
                </label>
                {enteredTotal > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoCalculateInterest}
                    className="text-[11px] underline text-accent-text cursor-pointer"
                    title="คำนวณจาก ยอดรวม - เงินต้น"
                  >
                    เติมอัตโนมัติ
                  </button>
                )}
              </div>
              <Input
                id="mortgage-interest"
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                className="font-semibold tabular-nums"
              />
            </div>

            <div>
              <Label htmlFor="mortgage-fee" className="text-transfer">
                ค่าธรรมเนียม/ประกัน (฿)
              </Label>
              <Input
                id="mortgage-fee"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="font-semibold tabular-nums"
              />
            </div>
          </div>
        </div>

        {/* Total Paid & Remaining Balance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mortgage-total-paid">
              ยอดรวมที่ชำระจริง (฿) <span className="text-expense">*</span>
            </Label>
            <Input
              id="mortgage-total-paid"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={totalPaid}
              onChange={(e) => setTotalPaid(e.target.value)}
              className={`font-semibold tabular-nums ${
                isMismatched ? 'border-warning-border focus:border-warning' : ''
              }`}
            />
            {isMismatched && (
              <p className="mt-1.5 text-[11px] text-warning flex items-start gap-1 tabular-nums">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  ผลรวมเงินต้น+ดอกเบี้ย+ประกัน ({sumOfParts.toFixed(2)}) ไม่ตรงกับยอดชำระรวม ({enteredTotal.toFixed(2)})
                </span>
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="mortgage-remaining-balance">ยอดหนี้คงเหลือหลังชำระ (฿)</Label>
            <Input
              id="mortgage-remaining-balance"
              type="number"
              step="0.01"
              placeholder="เว้นว่างเพื่อให้คำนวณอัตโนมัติ"
              value={remainingBalance}
              onChange={(e) => setRemainingBalance(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-[11px] text-ink-muted mt-1">
              หากเว้นว่าง ระบบจะคำนวณจากยอดหนี้เดิมหักด้วยเงินต้น
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
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
          </Button>
        </div>
      </form>
    </Modal>
  );
}
