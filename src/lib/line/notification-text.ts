// Reads the amount, accounts and time out of a free-text bank notification.
// No `@/` imports here: this module is loaded directly by the node test runner.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { KPLUS_ACCOUNT, MAKE_ACCOUNT, kbankAccountsInText, stripMaskedAccounts } from '../statement/accounts.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseThaiDateTime } from './kbank-card.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getBangkokDateTime } from '../utils/date.ts';

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const BALANCE_LABEL = /คงเหลือ\s*:?\s*$/;

function toAmount(raw: string): number {
  const value = parseFloat(raw.replace(/,/g, ''));
  return !isNaN(value) && value > 0 ? value : 0;
}

/** Removes the numbers that are never the amount: masked accounts, dates and times */
function amountCandidatesText(text: string): string {
  return stripMaskedAccounts(text)
    .replace(/\d{1,2}\s*[ก-๙]+\.[ก-๙]+\.?\s*\d{2,4}/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');
}

/** The transaction amount in a notification, or 0 when there is none. The balance is never the amount. */
export function extractNotificationAmount(text: string): number {
  const clean = amountCandidatesText(text);

  // A number right after an amount label ("จำนวนเงิน -150.00", "โอน 500")
  const labelled = clean.match(new RegExp(String.raw`(?:จำนวนเงิน|จำนวน|ยอดเงิน(?!คงเหลือ)|ยอดโอน|เงินเข้า|เงินออก|ชำระ|โอน)\s*:?\s*[-−]?\s*(${NUMBER})`, 'i'));
  if (labelled && toAmount(labelled[1]) > 0) return toAmount(labelled[1]);

  // Otherwise a number with a currency, then a number with satang; skipping balances
  const notBalance = (matches: IterableIterator<RegExpMatchArray>) =>
    [...matches].filter(m => !BALANCE_LABEL.test(clean.slice(0, m.index))).map(m => toAmount(m[1])).find(n => n > 0);
  const withCurrency = notBalance(clean.matchAll(new RegExp(`(${NUMBER})\\s*(?:บาท|THB)`, 'gi')));
  if (withCurrency) return withCurrency;
  const withSatang = notBalance(clean.matchAll(/(\d[\d,]*\.\d{2})/g));
  if (withSatang) return withSatang;

  // A bare number, only when it is the only one left
  const numbers = [...clean.matchAll(new RegExp(`(${NUMBER})`, 'g'))];
  return numbers.length === 1 ? toAmount(numbers[0][1]) : 0;
}

export interface NotificationFacts {
  amount: number;
  hasKplus: boolean;
  hasMake: boolean;
  date: string;
  time: string;
}

export function parseNotificationText(text: string, receivedAt: Date = new Date()): NotificationFacts {
  const mentioned = kbankAccountsInText(text);
  return {
    amount: extractNotificationAmount(text),
    hasKplus: mentioned.has(KPLUS_ACCOUNT),
    hasMake: mentioned.has(MAKE_ACCOUNT) || /make/i.test(text),
    // The time the bank printed; receive time only when the text has none
    ...(parseThaiDateTime(text) ?? getBangkokDateTime(receivedAt)),
  };
}
