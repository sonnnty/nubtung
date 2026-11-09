// Accounts the dashboard tracks, and which KBank statement belongs to which of them.
// No `@/` imports here: this module is loaded directly by the node test runner.

export const KPLUS_ACCOUNT = 'K PLUS';
export const MAKE_ACCOUNT = 'Make by KBank';
export const PAOTANG_ACCOUNT = 'เป๋าตัง';

/** Accounts that KBank sends e-statements for */
export type StatementAccount = typeof KPLUS_ACCOUNT | typeof MAKE_ACCOUNT;

interface TrackedAccount {
  name: string;
  last4: string;
  /** The digits a masked account ("xxx-x-x6665-x") shows; null without a full account number */
  maskDigits: string | null;
  /** Extra (lower-case) text that identifies the account in statement details besides "x<last4>" */
  keywords: RegExp | null;
}

function last4(value: string | undefined, fallback: string): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : fallback;
}

/** Digits 6-9 of a 10-digit account number: what KBank shows in "xxx-x-x6665-x" (the last digit stays hidden) */
export function maskDigitsOf(accountNo: string | undefined): string | null {
  const digits = (accountNo || '').replace(/\D/g, '');
  return digits.length === 10 ? digits.slice(5, 9) : null;
}

/** Bank accounts (besides cash) whose balance the dashboard tracks, read from env at call time */
export function getTrackedAccounts(): TrackedAccount[] {
  return [
    // No keyword for K PLUS: "K PLUS" is also the channel name printed on Make statements
    { name: KPLUS_ACCOUNT, last4: last4(process.env.KPLUS_ACCOUNT_NO, '6651'), maskDigits: maskDigitsOf(process.env.KPLUS_ACCOUNT_NO), keywords: null },
    { name: MAKE_ACCOUNT, last4: last4(process.env.MAKE_ACCOUNT_NO, '2996'), maskDigits: maskDigitsOf(process.env.MAKE_ACCOUNT_NO), keywords: /make by kbank/i },
    { name: PAOTANG_ACCOUNT, last4: last4(process.env.PAOTANG_ACCOUNT_NO, '9289'), maskDigits: null, keywords: /g-wallet|เป๋าตัง/i },
  ];
}

export function statementAccountFromLast4(digits: string | null | undefined): StatementAccount | null {
  if (!digits) return null;
  for (const acc of getTrackedAccounts()) {
    if (acc.last4 === digits && (acc.name === KPLUS_ACCOUNT || acc.name === MAKE_ACCOUNT)) {
      return acc.name as StatementAccount;
    }
  }
  return null;
}

/** "STM_SA2996_01OCT26_29OCT26.pdf" -> "2996" */
export function last4FromStatementFileName(fileName: string): string | null {
  const m = fileName.match(/STM_SA(\d{4})/i);
  return m ? m[1] : null;
}

/** "เลขที่บัญชีเงินฝาก 118-3-96299-6" -> "2996" */
export function last4FromStatementHeader(text: string): string | null {
  const m = text.match(/เลขที่บัญชีเงินฝาก\s+([\d-]{6,})/);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Which tracked account a statement belongs to: file name first, then the account number in the
 * PDF header. Returns null for an account the dashboard does not know (never assume K PLUS).
 */
export function detectStatementAccount(fileName: string, text?: string): StatementAccount | null {
  const fromName = statementAccountFromLast4(last4FromStatementFileName(fileName));
  if (fromName) return fromName;
  return text ? statementAccountFromLast4(last4FromStatementHeader(text)) : null;
}

/**
 * The tracked own account on the other side of a self-transfer, judged from the statement row's
 * details. The statement's own account is excluded: on a Make statement "MAKE by KBank" is just the
 * channel, and "X6651" means K PLUS.
 */
export function findTrackedCounterparty(detailText: string, statementAccount: string): string | null {
  const text = detailText.toLowerCase();
  const others = getTrackedAccounts().filter(acc => acc.name !== statementAccount);
  for (const acc of others) {
    if (text.includes(`x${acc.last4}`)) return acc.name;
  }
  for (const acc of others) {
    if (acc.keywords && acc.keywords.test(text)) return acc.name;
  }
  return null;
}

const MASK_CHARS = 'xX*•';
const MASKED_ACCOUNT = new RegExp(`[${MASK_CHARS}][-${MASK_CHARS}]*(\\d{3,})(?:-?[${MASK_CHARS}]+)?`, 'g');

/** Text with masked account numbers ("xxx-x-x6665-x", "X2996") removed, so their digits are not read as amounts */
export function stripMaskedAccounts(text: string): string {
  return text.replace(MASKED_ACCOUNT, ' ');
}

/** The KBank account (K PLUS or Make) a masked number like "xxx-x-x6665-x" belongs to, or null if it is not one of mine */
export function accountFromMask(masked: string | null | undefined): StatementAccount | null {
  const compact = (masked || '').replace(/\s/g, '');
  const m = compact.match(new RegExp(`^(?:[^\\d]*?)[${MASK_CHARS}]{3}-?[${MASK_CHARS}]-?[${MASK_CHARS}](\\d{4})-?[${MASK_CHARS}]$`));
  if (!m) return null;
  const owners = getTrackedAccounts().filter(acc => acc.maskDigits === m[1]);
  return owners.length === 1 ? owners[0].name as StatementAccount : null;
}

/**
 * Tracked KBank accounts a piece of text mentions: by full number, masked number (the "x6665-x" and
 * "X2996" forms), or last 4 digits standing alone (never digits that are part of an amount).
 */
export function kbankAccountsInText(text: string): Set<StatementAccount> {
  const found = new Set<StatementAccount>();
  const compact = text.replace(/[-\s]/g, '');
  const maskedGroups = [...text.matchAll(MASKED_ACCOUNT)].map(m => m[1]);
  const accounts: Array<{ name: StatementAccount; full?: string }> = [
    { name: KPLUS_ACCOUNT, full: process.env.KPLUS_ACCOUNT_NO },
    { name: MAKE_ACCOUNT, full: process.env.MAKE_ACCOUNT_NO },
  ];
  for (const { name, full } of accounts) {
    const tracked = getTrackedAccounts().find(acc => acc.name === name)!;
    const fullDigits = (full || '').replace(/\D/g, '');
    const standsAlone = new RegExp(`(?<![\\d.,])${tracked.last4}(?![\\d.,]|\\s*(?:บาท|THB))`, 'i').test(text);
    if (
      (fullDigits.length >= 10 && compact.includes(fullDigits)) ||
      maskedGroups.some(g => g === tracked.last4 || (tracked.maskDigits && g === tracked.maskDigits)) ||
      standsAlone
    ) {
      found.add(name);
    }
  }
  return found;
}

/** The tracked account a slip's receiver account number points to (masked, partial or full), or null */
export function trackedAccountFromNumber(number: string | null | undefined): string | null {
  const digits = (number || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  const owners = getTrackedAccounts().filter(acc =>
    digits.endsWith(acc.last4) || (acc.maskDigits !== null && digits.endsWith(acc.maskDigits)));
  return owners.length === 1 ? owners[0].name : null;
}
