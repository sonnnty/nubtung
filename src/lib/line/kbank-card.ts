// The cards of the LINE chat "KBank Live": what the phone bridge posts, parsed into structured data.
// No `@/` imports here: this module is loaded directly by the node test runner.
import { createHash } from 'node:crypto';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { accountFromMask } from '../statement/accounts.ts';

export type CardDirection = 'OUT' | 'IN';

/** What the phone bridge read from one card; fields are raw text, spacing not normalised */
export interface RawCard {
  title?: unknown;
  date?: unknown;
  account?: unknown;
  amount?: unknown;
  balance?: unknown;
  messageId?: unknown;
}

export interface KBankCard {
  key: string;
  title: string;
  account: string;
  date: string;
  time: string;
  direction: CardDirection;
  /** Always positive; `direction` says which way the money went */
  amount: number;
  balance: number;
  messageId: string | null;
}

export type CardParseResult =
  | { ok: true; card: KBankCard }
  | { ok: false; reason: string };

const CARD_TITLES: Record<string, CardDirection> = {
  'รายการโอน/ถอน': 'OUT',
  'รายการเงินเข้า': 'IN',
};

const THAI_MONTHS: Record<string, number> = {
  'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6,
  'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
};

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** "9 พ.ย. 69 21:28 น." (short Buddhist-era year, Bangkok time) -> { date: "2026-11-09", time: "21:28:00" } */
export function parseThaiDateTime(text: string): { date: string; time: string } | null {
  const m = normalizeWhitespace(text).match(/(\d{1,2})\s*([ก-๙]+\.[ก-๙]+)\.?\s*(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const month = THAI_MONTHS[m[2]];
  if (!month) return null;
  const day = parseInt(m[1], 10);
  const beYear = m[3].length === 2 ? 2500 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const year = beYear - 543;
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}:00` };
}

/** A signed money amount as a card shows it: "-150.00", "13,698.33  บาท" */
export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const clean = value.replace(/บาท|THB/gi, '').replace(/[\s,]/g, '').replace(/[−–]/g, '-');
  return /^[+-]?\d+(\.\d+)?$/.test(clean) ? parseFloat(clean) : null;
}

/** Identity of a card. Two equal purchases in one minute still differ by balance. */
export function cardKey(card: { account: string; date: string; time: string; direction: CardDirection; amount: number; balance: number }): string {
  const signed = card.direction === 'OUT' ? -card.amount : card.amount;
  return `${card.account}|${card.date}T${card.time.slice(0, 5)}|${signed.toFixed(2)}|${card.balance.toFixed(2)}`;
}

/** Sheet row id of the row a card creates. Deterministic, so a retried post finds the row it already wrote. */
export function cardRowId(key: string): string {
  return `line_${createHash('sha1').update(key).digest('hex').slice(0, 20)}`;
}

/** Parses a posted card. Anything not understood is a reason for review; nothing is guessed into the ledger. */
export function parseCard(raw: RawCard): CardParseResult {
  const title = typeof raw.title === 'string' ? normalizeWhitespace(raw.title) : '';
  const direction = CARD_TITLES[title.replace(/\s/g, '')];
  if (!direction) return { ok: false, reason: `unknown card title: "${title}"` };

  const account = typeof raw.account === 'string' ? accountFromMask(raw.account) : null;
  if (!account) return { ok: false, reason: `unknown account: "${String(raw.account ?? '')}"` };

  const when = typeof raw.date === 'string' ? parseThaiDateTime(raw.date) : null;
  if (!when) return { ok: false, reason: `unreadable date: "${String(raw.date ?? '')}"` };

  const amount = parseMoney(raw.amount);
  if (amount === null || amount === 0) return { ok: false, reason: `unreadable amount: "${String(raw.amount ?? '')}"` };
  if ((direction === 'OUT') !== (amount < 0)) {
    return { ok: false, reason: `amount sign ${amount} does not fit title "${title}"` };
  }

  const balance = parseMoney(raw.balance);
  if (balance === null) return { ok: false, reason: `unreadable balance: "${String(raw.balance ?? '')}"` };

  const base = { account, date: when.date, time: when.time, direction, amount: Math.abs(amount), balance };
  return {
    ok: true,
    card: {
      ...base,
      title,
      key: cardKey(base),
      messageId: typeof raw.messageId === 'string' && raw.messageId.trim() ? raw.messageId.trim() : null,
    },
  };
}
