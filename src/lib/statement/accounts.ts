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
  /** Extra (lower-case) text that identifies the account in statement details besides "x<last4>" */
  keywords: RegExp | null;
}

function last4(value: string | undefined, fallback: string): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : fallback;
}

/** Bank accounts (besides cash) whose balance the dashboard tracks, read from env at call time */
export function getTrackedAccounts(): TrackedAccount[] {
  return [
    // No keyword for K PLUS: "K PLUS" is also the channel name printed on Make statements
    { name: KPLUS_ACCOUNT, last4: last4(process.env.KPLUS_ACCOUNT_NO, '6651'), keywords: null },
    { name: MAKE_ACCOUNT, last4: last4(process.env.MAKE_ACCOUNT_NO, '2996'), keywords: /make by kbank/i },
    { name: PAOTANG_ACCOUNT, last4: last4(process.env.PAOTANG_ACCOUNT_NO, '9289'), keywords: /g-wallet|เป๋าตัง/i },
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
