// Parses the text of a KBank savings e-statement (`pdftotext -layout` output).
// No `@/` imports here: this module is loaded directly by the node test runner.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { KPLUS_ACCOUNT, detectStatementAccount, findTrackedCounterparty, last4FromStatementHeader, type StatementAccount } from './accounts.ts';

export interface StatementTransaction {
  date: string;
  time: string;
  typeDesc: string;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  category: string;
  /** The account this statement belongs to (the account the row happened on) */
  channel: string;
  details: string;
  balance?: number;
  /** IN = deposit column, OUT = withdrawal column */
  direction: 'IN' | 'OUT';
  /**
   * For a transfer between my own tracked accounts: the account on the other side
   * (receiver when direction is OUT, sender when IN). Null for everything else.
   */
  counterparty: string | null;
}

export interface StatementHeader {
  accountLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  withdrawalCount: number | null;
  withdrawalTotal: number | null;
  depositCount: number | null;
  depositTotal: number | null;
}

export interface ParsedStatement {
  account: StatementAccount | null;
  header: StatementHeader;
  transactions: StatementTransaction[];
}

interface RawStatementRow {
  date: string;
  time: string;
  typeDesc: string;
  withdrawal: number | null;
  deposit: number | null;
  balance?: number;
  rawRest: string;
}

const TX_LINE = /^\s*(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([^\d\s][^\d]+?)\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s+(.+)$/;
// Page header / footer text that must never be glued onto a transaction's details
const NOT_DETAILS = /ยอดยกไป|ยอดยกมา|รวมถอนเงิน|รวมฝากเงิน|รอบระหว่างวันที่|เลขที่บัญชีเงินฝาก|สาขาเจ้าของบัญชี|หน้าที่|สอบถามข้อมูลเพิ่มเติม|ยอดคงเหลือ|KBPDF/;

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** "29/10/2026" -> "2026-10-29" (accepts Buddhist-era years too) */
function slashDateToIso(d: string, m: string, y: string): string {
  let year = parseInt(y, 10);
  if (year > 2400) year -= 543;
  return `${year}-${m}-${d}`;
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "STM_SA2996_01OCT26_29OCT26.pdf" -> "2026-10-29" */
export function periodEndFromStatementFileName(fileName: string): string | null {
  const m = fileName.match(/_\d{2}[A-Z]{3}\d{2}_(\d{2})([A-Z]{3})(\d{2})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  return month ? `20${m[3]}-${month}-${m[1]}` : null;
}

export function parseStatementHeader(text: string): StatementHeader {
  const period = text.match(/รอบระหว่างวันที่\s+(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const withdrawals = text.match(/รวมถอนเงิน\s+(\d+)\s+รายการ\s+([\d,]+\.\d{2})/);
  const deposits = text.match(/รวมฝากเงิน\s+(\d+)\s+รายการ\s+([\d,]+\.\d{2})/);
  const closing = text.match(/ยอดยกไป\s+(-?[\d,]+\.\d{2})/);
  const opening = text.match(/ยอดยกมา\s+(-?[\d,]+\.\d{2})/);

  return {
    accountLast4: last4FromStatementHeader(text),
    periodStart: period ? slashDateToIso(period[1], period[2], period[3]) : null,
    periodEnd: period ? slashDateToIso(period[4], period[5], period[6]) : null,
    openingBalance: toNumber(opening?.[1]),
    closingBalance: toNumber(closing?.[1]),
    withdrawalCount: withdrawals ? parseInt(withdrawals[1], 10) : null,
    withdrawalTotal: toNumber(withdrawals?.[2]),
    depositCount: deposits ? parseInt(deposits[1], 10) : null,
    depositTotal: toNumber(deposits?.[2]),
  };
}

/**
 * Parses a whole statement: which account it is for (null = unknown, caller must skip it),
 * the header figures, and the transactions classified relative to that account.
 */
export function parseStatement(text: string, fileName: string): ParsedStatement {
  const account = detectStatementAccount(fileName, text);
  const header = parseStatementHeader(text);
  if (!header.periodEnd) header.periodEnd = periodEndFromStatementFileName(fileName);
  return {
    account,
    header,
    transactions: account ? parseStatementText(text, account) : [],
  };
}

/** Header totals that disagree with the parsed rows, as human-readable warnings (empty when all match) */
export function checkStatementTotals(parsed: ParsedStatement): string[] {
  const { header, transactions } = parsed;
  const outs = transactions.filter(t => t.direction === 'OUT');
  const ins = transactions.filter(t => t.direction === 'IN');
  const sum = (txs: StatementTransaction[]) => Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const warnings: string[] = [];
  if (header.withdrawalCount !== null && header.withdrawalCount !== outs.length) {
    warnings.push(`withdrawals: header ${header.withdrawalCount}, parsed ${outs.length}`);
  }
  if (header.withdrawalTotal !== null && header.withdrawalTotal !== sum(outs)) {
    warnings.push(`withdrawal total: header ${header.withdrawalTotal}, parsed ${sum(outs)}`);
  }
  if (header.depositCount !== null && header.depositCount !== ins.length) {
    warnings.push(`deposits: header ${header.depositCount}, parsed ${ins.length}`);
  }
  if (header.depositTotal !== null && header.depositTotal !== sum(ins)) {
    warnings.push(`deposit total: header ${header.depositTotal}, parsed ${sum(ins)}`);
  }
  return warnings;
}

export function parseStatementText(text: string, account: string = KPLUS_ACCOUNT): StatementTransaction[] {
  const lines = text.split('\n');
  const transactions: StatementTransaction[] = [];
  let currentTx: RawStatementRow | null = null;
  // Wrapped details only continue directly below their row; a blank line, page footer or
  // page header ends them (otherwise the footer got glued onto the last row's details).
  let inDetails = false;

  for (const line of lines) {
    const match = line.match(TX_LINE);

    if (match) {
      if (currentTx) {
        transactions.push(finalizeTx(currentTx, account));
      }

      const [d, m, y] = match[1].split('-');
      const fullYear = parseInt(y, 10) < 50 ? '20' + y : '19' + y;
      const typeDesc = match[3].trim();
      const val1 = toNumber(match[4]);
      const val2 = toNumber(match[5]);

      let withdrawal: number | null = null;
      let deposit: number | null = null;
      if (val1 !== null && val2 !== null) {
        withdrawal = val1;
        deposit = val2;
      } else if (val1 !== null && val2 === null) {
        if (typeDesc.includes('รับ') || typeDesc.includes('ฝาก') || typeDesc.includes('ดอกเบี้ย')) {
          deposit = val1;
        } else {
          withdrawal = val1;
        }
      }

      currentTx = {
        date: `${fullYear}-${m}-${d}`,
        time: `${match[2]}:00`,
        typeDesc,
        withdrawal,
        deposit,
        balance: toNumber(match[6]) ?? undefined,
        rawRest: match[7].trim(),
      };
      inDetails = true;
    } else if (currentTx && inDetails && /^\s{60,}\S/.test(line) && !NOT_DETAILS.test(line)) {
      currentTx.rawRest += ' ' + line.trim();
    } else {
      inDetails = false;
    }
  }

  if (currentTx) {
    transactions.push(finalizeTx(currentTx, account));
  }

  return transactions;
}

function getOwnNames(): string[] {
  const ownNamesConfig = process.env.OWN_ACCOUNT_NAMES || 'วรโชติ,worachot';
  return ownNamesConfig.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function finalizeTx(raw: RawStatementRow, account: string): StatementTransaction {
  const isDeposit = raw.deposit !== null && raw.deposit > 0;
  const amount = isDeposit ? raw.deposit! : (raw.withdrawal || 0);

  const detailText = `${raw.typeDesc} ${raw.rawRest}`.toLowerCase();
  const isSelf = getOwnNames().some(name => detailText.includes(name));

  // "Tracked" means any account the dashboard tracks other than the one this statement is for
  const counterparty = isSelf ? findTrackedCounterparty(detailText, account) : null;

  // A deposit from one of my own accounts that the dashboard doesn't track (e.g. GHB)
  // is new money for this account. Recording it as TRANSFER makes the balance calc deduct it
  // from this account instead, so keep it as INCOME under the (tax-exempt) transfer category.
  const isFromUntrackedOwnAccount = isSelf && isDeposit && !counterparty;

  let type: 'EXPENSE' | 'INCOME' | 'TRANSFER' = isDeposit ? 'INCOME' : 'EXPENSE';
  if (isSelf && !isFromUntrackedOwnAccount) {
    type = 'TRANSFER';
  }

  const category = isFromUntrackedOwnAccount
    ? 'โอนระหว่างบัญชี'
    : categorizeStatementRow(raw.typeDesc, raw.rawRest, type);

  return {
    date: raw.date,
    time: raw.time,
    typeDesc: raw.typeDesc,
    type,
    amount,
    category,
    channel: account,
    details: `${raw.typeDesc}: ${raw.rawRest}`,
    balance: raw.balance,
    direction: isDeposit ? 'IN' : 'OUT',
    counterparty,
  };
}

function categorizeStatementRow(txDesc: string, rest: string, type: 'EXPENSE' | 'INCOME' | 'TRANSFER'): string {
  if (type === 'TRANSFER') return 'โอนระหว่างบัญชี';
  if (type === 'INCOME') return 'เงินเดือน/รายรับ';

  const text = `${txDesc} ${rest}`.toLowerCase();
  if (/shopee|lazada|tiktok|เครื่องรูดบัตร|edc/i.test(text)) return 'ช้อปปิ้ง';
  if (/ปตท|ptt|บางจาก|shell|caltex|น้ำมัน|ทางด่วน/i.test(text)) return 'การเดินทาง/ค่าน้ำมัน';
  if (/เซเว่น|7-eleven|cj express|lotus|โลตัส|big c|บิ๊กซี|central food/i.test(text)) return 'ของใช้ในบ้าน/ซูเปอร์';
  if (/ไฟฟ้า|ประปา|ais|true|dtac|เน็ต|3bb|nt/i.test(text)) return 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)';
  if (/อาหาร|กาแฟ|cafe|amazon|ข้าวมันไก่|กะเพรา|ชา|มณี shop/i.test(text)) return 'อาหารและเครื่องดื่ม';
  if (/ยา|คลินิก|โรงพยาบาล|health|medical/i.test(text)) return 'สุขภาพ/ยา';
  return 'อื่นๆ';
}
