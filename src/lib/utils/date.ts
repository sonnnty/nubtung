/**
 * Utilities for formatting and handling dates in Thailand / Bangkok timezone (UTC+7).
 * Ensures consistency across server and client, regardless of server's native system timezone.
 */

const TIMEZONE = 'Asia/Bangkok';

/**
 * Returns the current date formatted as YYYY-MM-DD in Asia/Bangkok (UTC+7).
 */
export function getBangkokDateString(date: Date = new Date()): string {
  // 'en-CA' outputs ISO-like format: YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns the time formatted as HH:mm:ss in Asia/Bangkok (UTC+7, 24-hour).
 */
export function getBangkokTimeString(date: Date = new Date()): string {
  // 'en-GB' outputs 24-hour format: HH:mm:ss
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Returns the time formatted as HH:mm in Asia/Bangkok (UTC+7, 24-hour).
 */
export function getBangkokTimeShortString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Returns both date (YYYY-MM-DD) and time (HH:mm:ss) in Asia/Bangkok (UTC+7).
 */
export function getBangkokDateTime(date: Date = new Date()): { date: string; time: string } {
  return {
    date: getBangkokDateString(date),
    time: getBangkokTimeString(date),
  };
}

const MONTH_NAMES: Record<string, number> = {
  'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6,
  'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** A 2-digit year is Buddhist era from 40 up ("69" is 2569), else Christian; 4-digit years above 2400 are Buddhist */
function christianYear(year: string): number {
  const y = parseInt(year, 10);
  if (year.length <= 2) return y >= 40 ? y + 2500 - 543 : y + 2000;
  return y > 2400 ? y - 543 : y;
}

const pad2 = (n: string | number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: string | number, d: string | number) => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * Dates as the Sheet and old rows spell them, to YYYY-MM-DD: ISO (also with a time or a Buddhist
 * year), D/M/Y with / . or -, month names in Thai or English, and Google's date serial numbers.
 * A value it cannot read comes back as it is, so nothing is lost.
 */
export function normalizeDateString(dateStr?: string): string {
  if (!dateStr) return '';
  const clean = dateStr.trim();

  let m = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return isoDate(christianYear(m[1]), m[2], m[3]);

  m = clean.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[\s,].*)?$/);
  if (m) return isoDate(christianYear(m[3]), m[2], m[1]);

  m = clean.match(/^(\d{1,2})\s*([^\d\s,]+?)\.?\s*,?\s*(\d{4}|\d{2})\b/);
  if (m && MONTH_NAMES[m[2].toLowerCase()]) return isoDate(christianYear(m[3]), MONTH_NAMES[m[2].toLowerCase()], m[1]);

  m = clean.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}|\d{2})\b/);
  if (m && MONTH_NAMES[m[1].slice(0, 3).toLowerCase()]) return isoDate(christianYear(m[3]), MONTH_NAMES[m[1].slice(0, 3).toLowerCase()], m[2]);

  // A date cell read as a plain number: days since Google's epoch, 1899-12-30
  if (/^\d{5}(\.\d+)?$/.test(clean)) {
    const days = Math.floor(parseFloat(clean));
    return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
  }

  return clean;
}

export function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Times as the Sheet spells them, to HH:mm:ss; a value it cannot read comes back as midnight */
export function normalizeTimeString(timeStr?: string): string {
  if (!timeStr) return '00:00:00';
  const clean = timeStr.trim();
  if (!clean) return '00:00:00';

  // A time cell read as a plain number: a fraction of a day
  if (/^0?\.\d+$/.test(clean)) {
    const seconds = Math.round(parseFloat(clean) * 86400);
    return `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor(seconds / 60) % 60)}:${pad2(seconds % 60)}`;
  }

  const isPM = /p\.?\s*m/i.test(clean);
  const isAM = /a\.?\s*m/i.test(clean);
  // "13.30 น." is 13:30; the dot of "น." is not a separator
  const numOnly = clean.replace(/(\d)\.(\d)/g, '$1:$2').replace(/[^\d:]/g, '');
  const parts = numOnly.split(':');

  let h = parseInt(parts[0] || '0', 10) || 0;
  const m = parseInt(parts[1] || '0', 10) || 0;
  const s = parseInt(parts[2] || '0', 10) || 0;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
