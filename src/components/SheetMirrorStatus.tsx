'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Sheet } from 'lucide-react';
import { readJson } from '@/lib/utils/http';

interface Health {
  state: 'not_migrated' | 'ok' | 'pending' | 'failing' | 'stuck';
  lastMirroredAt: string | null;
  pending: number;
  lastError: string | null;
}

const REFRESH_MS = 60_000;

function lastMirroredLabel(iso: string | null): string {
  if (!iso) return 'ยังไม่เคยส่ง';
  return new Date(iso).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
}

/** Small mirror health indicator for the owner: last time the Sheet was updated, and a warning when it is not */
export default function SheetMirrorStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/sheet-mirror');
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || 'Sheet status request failed');
        if (cancelled) return;
        setHealth(data);
        setLoadError(null);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const warning = loadError
    ? `อ่านสถานะ Sheet ไม่ได้: ${loadError}`
    : health?.state === 'not_migrated'
      ? 'ยังไม่ได้ย้ายข้อมูลจาก Sheet เข้า Postgres'
      : health?.state === 'stuck'
        ? `Sheet ค้าง: ${health.pending} รายการยังไม่ถูกส่ง${health.lastError ? ` (${health.lastError})` : ''}`
        : health?.state === 'failing'
          ? `ส่งข้อมูลไป Sheet ไม่สำเร็จ ระบบกำลังลองใหม่: ${health.lastError ?? ''}`
          : null;

  if (warning) {
    return (
      <span
        title={warning}
        role="status"
        className="flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 max-w-[12rem]"
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline truncate">{warning}</span>
      </span>
    );
  }

  if (!health) return null;

  return (
    <span
      title={health.pending > 0 ? `กำลังส่งไป Google Sheet ${health.pending} รายการ` : 'Google Sheet เป็นปัจจุบัน'}
      className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
    >
      <Sheet className="w-3.5 h-3.5 shrink-0" />
      <span>{lastMirroredLabel(health.lastMirroredAt)}</span>
      {health.pending > 0 && <span>· รอส่ง {health.pending}</span>}
    </span>
  );
}
