'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { readJson } from '@/lib/utils/http';
import { Button } from './ui';

interface SyncButtonProps {
  onSyncComplete?: () => void;
}

export default function SyncButton({ onSyncComplete }: SyncButtonProps) {
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string>('ซิงค์ข้อมูลทั้งหมด');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSyncAll = async () => {
    setLoading(true);
    setResultMessage(null);
    setIsError(false);

    try {
      // The server runs the sync in the background; poll until it finishes so a long OCR run
      // never exceeds the reverse proxy's request timeout.
      setStatusText('กำลังสแกนสลิป...');
      const startRes = await fetch('/api/sync', { method: 'POST' });
      let job = await readJson(startRes);
      if (!startRes.ok) {
        throw new Error(job.error || 'Sync failed to start');
      }

      while (job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const pollRes = await fetch(`/api/sync?jobId=${encodeURIComponent(job.id ?? job.jobId)}`);
        job = await readJson(pollRes);
        if (!pollRes.ok) {
          throw new Error(job.error || 'Sync status check failed');
        }
        setStatusText(
          job.stage === 'statements'
            ? 'กำลังกระทบยอด Statement...'
            : job.stage === 'mortgage'
            ? 'กำลังดึงใบเสร็จค่าบ้าน...'
            : 'กำลังสแกนสลิป...'
        );
      }

      if (job.status === 'error') {
        throw new Error(job.error || 'Sync failed');
      }

      if (job.result.slipsError) {
        throw new Error(job.result.slipsError);
      }
      if (job.result.statementError) {
        throw new Error(job.result.statementError);
      }

      const stmData = job.result.statement ?? {};
      const slipProcessed = job.result.slips?.processed ?? 0;
      const stmAdded = stmData.addedFromStatement ?? 0;
      const stmMatched = stmData.matchedWithSlip ?? 0;
      const ledger = job.result.slips?.ledger ?? {};
      const lineMatched =
        (ledger.merged ?? 0) +
        (ledger.corrected ?? 0) +
        (ledger.confirmed ?? 0) +
        (ledger.undone ?? 0) +
        (ledger.adopted ?? 0);

      const parts: string[] = [];
      if (slipProcessed > 0) parts.push(`สลิปใหม่ ${slipProcessed} รายการ`);
      if (lineMatched > 0) parts.push(`สลิปตรงกับการ์ด LINE ${lineMatched} รายการ`);
      if (stmMatched > 0) parts.push(`Statement ตรงกับสลิป ${stmMatched} รายการ`);
      if (stmAdded > 0) parts.push(`Statement ใหม่ ${stmAdded} รายการ`);

      if (parts.length > 0) {
        setResultMessage(`ซิงค์สำเร็จ! (${parts.join(', ')})`);
      } else {
        setResultMessage('ข้อมูลเป็นปัจจุบันแล้ว (ไม่มีสลิปหรือ Statement ใหม่)');
      }

      if (onSyncComplete) onSyncComplete();

      // Auto dismiss message after 5 seconds
      setTimeout(() => {
        setResultMessage(null);
      }, 5000);
    } catch (err: unknown) {
      setIsError(true);
      setResultMessage(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการซิงค์ข้อมูล');
    } finally {
      setLoading(false);
      setStatusText('ซิงค์ข้อมูลทั้งหมด');
    }
  };

  return (
    <div className="flex flex-col items-end relative">
      <Button
        variant="primary"
        size="sm"
        onClick={handleSyncAll}
        disabled={loading}
        title="ซิงค์ข้อมูลทั้งหมด (สลิปและ Statement)"
        aria-label={statusText}
        className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-0 px-2.5 sm:px-3.5"
      >
        <RefreshCw className={`w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{statusText}</span>
      </Button>

      {resultMessage && (
        <div
          role={isError ? 'alert' : 'status'}
          className={`absolute top-12 right-0 z-50 text-xs px-3.5 py-2.5 rounded-card flex items-center gap-2 shadow-popover border max-w-[85vw] sm:max-w-md bg-surface ${
            isError
              ? 'border-expense-border text-ink'
              : 'border-income-border text-ink'
          }`}
        >
          {isError ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-expense" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-income" />
          )}
          <span className="font-medium leading-snug">{resultMessage}</span>
        </div>
      )}
    </div>
  );
}
