import type {
  IncomeBySection,
  ExemptionReason,
  TaxBreakdownTransaction,
  CategorizeTransactionsResult,
  SavedTaxProfile,
} from './tax-types.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { defaultIncome } from './tax-engine.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { isBalanceAdjustment } from '../balance/balance-adjustment.ts';

export type {
  ExemptionReason,
  TaxBreakdownTransaction,
  CategorizeTransactionsResult,
  SavedTaxProfile,
};

export function mapCategoryToSection(categoryName: string): keyof IncomeBySection {
  const norm = (categoryName || '').toLowerCase().trim();

  // 40(1) Salary & Bonus
  if (
    norm.includes('เงินเดือน') ||
    norm.includes('salary') ||
    norm.includes('โบนัส') ||
    norm.includes('bonus') ||
    norm.includes('เบี้ยเลี้ยง')
  ) {
    return 'section40_1';
  }

  // 40(2) Freelance & Services
  if (
    norm.includes('ฟรีแลนซ์') ||
    norm.includes('freelance') ||
    norm.includes('รับจ้าง') ||
    norm.includes('ค่านายหน้า') ||
    norm.includes('คอมมิชชั่น') ||
    norm.includes('จ้างทำของ')
  ) {
    return 'section40_2';
  }

  // 40(3) Royalties & IP
  if (norm.includes('ลิขสิทธิ์') || norm.includes('royalty') || norm.includes('สิทธิบัตร')) {
    return 'section40_3';
  }

  // 40(4) Dividends & Interest
  if (
    norm.includes('ดอกเบี้ย') ||
    norm.includes('ปันผล') ||
    norm.includes('dividend') ||
    norm.includes('interest') ||
    norm.includes('คริปโต') ||
    norm.includes('crypto')
  ) {
    return 'section40_4';
  }

  // 40(5) Rent
  if (norm.includes('ค่าเช่า') || /\brent\b/i.test(norm) || norm.includes('เช่าบ้าน')) {
    return 'section40_5';
  }

  // 40(6) Liberal professions
  if (norm.includes('วิชาชีพอิสระ') || norm.includes('คลินิก') || norm.includes('ทนาย')) {
    return 'section40_6';
  }

  // 40(7) Contracting / Construction
  if (norm.includes('รับเหมา') || norm.includes('ก่อสร้าง')) {
    return 'section40_7';
  }

  // Default to 40(8) Business / Commerce / Other
  return 'section40_8';
}

/**
 * Checks whether a transaction category or note qualifies for tax exemption
 * under Thai tax regulations (e.g. loan disbursements/cashback, Section 42(26) family support,
 * cost sharing/reimbursements, or inter-account transfers/refunds).
 */
export function checkTaxExemption(
  category: string,
  note?: string
): { isExempt: boolean; reason?: ExemptionReason } {
  const cat = (category || '').toLowerCase().trim();
  const n = (note || '').toLowerCase().trim();
  const text = `${cat} ${n}`.trim();

  if (!text) {
    return { isExempt: false };
  }

  // 1. Loan / Cashback / Mortgage
  // Loan proceeds, mortgage cashback, excess loan disbursements are not taxable income.
  const isLoanCashback =
    text.includes('เงินกู้') ||
    text.includes('กู้บ้าน') ||
    text.includes('กู้คอนโด') ||
    text.includes('กู้ซื้อ') ||
    text.includes('กู้ร่วม') ||
    text.includes('ส่วนต่าง') ||
    text.includes('เงินทอน') ||
    text.includes('cashback') ||
    text.includes('สินเชื่อ') ||
    text.includes('ธอส') ||
    text.includes('เงินเหลือ') ||
    text.includes('วงเงินกู้') ||
    text.includes('mortgage') ||
    /\bloan\b/i.test(text);

  if (isLoanCashback) {
    return { isExempt: true, reason: 'LOAN_CASHBACK' };
  }

  // 2. Excluded Categories, Transfers and Refunds
  // Non-taxable categories such as tax refunds and account transfers.
  const isRefundTransfer =
    text.includes('โอนระหว่างบัญชี') ||
    text.includes('เงินยกเว้นภาษี') ||
    text.includes('เงินคืนภาษี') ||
    text.includes('คืนเงินภาษี') ||
    text.includes('เงินคืน') ||
    text.includes('โอนย้ายเงิน') ||
    text.includes('โอนย้าย') ||
    /\brefund\b/i.test(text);

  if (isRefundTransfer) {
    return { isExempt: true, reason: 'REFUND_TRANSFER' };
  }

  // 3. Family Support (Section 42(26) of Revenue Code)
  // Maintenance support or moral gifts from parents, ascendants, or descendants.
  // Exclude merchant words (แม่ค้า, พ่อค้า, แม่บ้าน, แม่พิมพ์) to prevent false positives.
  const textWithoutMerchants = text.replace(/แม่ค้า|พ่อค้า|แม่บ้าน|แม่พิมพ์/g, '');
  const isFamilySupport =
    text.includes('พ่อแม่') ||
    text.includes('บุพการี') ||
    text.includes('ครอบครัว') ||
    text.includes('ให้โดยเสน่หา') ||
    text.includes('อุปการะ') ||
    textWithoutMerchants.includes('พ่อ') ||
    textWithoutMerchants.includes('แม่') ||
    /\bparents?\b/i.test(text) ||
    /\bfamily\b/i.test(text);

  if (isFamilySupport) {
    return { isExempt: true, reason: 'FAMILY_SUPPORT' };
  }

  // 4. Cost Sharing / Reimbursement
  // Shared expenses among housemates/friends and reimbursements are not assessable income.
  // Exclude 'อาหาร', 'บริหาร', 'ทหาร' so 'อาหาร' doesn't false positive match substring 'หาร'.
  const textWithoutFoodAndMgmt = text.replace(/อาหาร|บริหาร|ทหาร/g, '');
  const isCostSharing =
    text.includes('แชร์') ||
    text.includes('ช่วยค่าบ้าน') ||
    text.includes('ช่วยผ่อน') ||
    text.includes('reimburse') ||
    text.includes('คืนเงิน') ||
    text.includes('ยืม') ||
    text.includes('สำรองจ่าย') ||
    text.includes('จ่ายแทน') ||
    text.includes('cost sharing') ||
    textWithoutFoodAndMgmt.includes('หาร') ||
    /\bshare\b/i.test(text) ||
    /\bsplit\b/i.test(text);

  if (isCostSharing) {
    return { isExempt: true, reason: 'COST_SHARING' };
  }

  return { isExempt: false };
}

/**
 * Categorizes transactions into their respective tax sections (40(1) to 40(8))
 * or exempt status, taking into account auto-exclusion rules and user overrides.
 */
export function categorizeTransactionsForTax(
  transactions: Array<{
    id?: string;
    date?: string;
    time?: string;
    type?: string;
    amount: number;
    category: string;
    account?: string;
    note?: string;
  }>,
  userExcludedIds?: string[] | Set<string> | Iterable<string>
): CategorizeTransactionsResult {
  const syncedIncome: IncomeBySection = { ...defaultIncome };
  const transactionsBySection: Record<keyof IncomeBySection, TaxBreakdownTransaction[]> = {
    section40_1: [],
    section40_2: [],
    section40_3: [],
    section40_4: [],
    section40_5: [],
    section40_6: [],
    section40_7: [],
    section40_8: [],
  };
  const exemptTransactions: TaxBreakdownTransaction[] = [];
  let totalTaxableIncome = 0;
  let totalExemptIncome = 0;

  const excludedSet =
    userExcludedIds instanceof Set
      ? userExcludedIds
      : new Set(userExcludedIds || []);

  for (const tx of transactions) {
    // Only process INCOME transactions (ignore EXPENSE and TRANSFER)
    if (tx.type && tx.type !== 'INCOME') {
      continue;
    }
    // A balance adjustment only aligns the ledger with the bank; it is not income
    if (isBalanceAdjustment(tx)) {
      continue;
    }

    const amount = Number(tx.amount) || 0;
    const section = mapCategoryToSection(tx.category);
    const exemption = checkTaxExemption(tx.category, tx.note);
    const txId = tx.id || '';
    const isUserExcluded = txId ? excludedSet.has(txId) : false;
    const isExempt = exemption.isExempt;

    const breakdownTx: TaxBreakdownTransaction = {
      id: txId,
      date: tx.date || '',
      time: typeof tx.time === 'string' ? tx.time : undefined,
      type: tx.type || 'INCOME',
      amount,
      category: tx.category || '',
      account: typeof tx.account === 'string' ? tx.account : undefined,
      note: typeof tx.note === 'string' ? tx.note : undefined,
      section,
      isExempt,
      exemptionReason: exemption.reason,
      isUserExcluded,
    };

    if (isExempt || isUserExcluded) {
      exemptTransactions.push(breakdownTx);
      totalExemptIncome += amount;
    } else {
      transactionsBySection[section].push(breakdownTx);
      syncedIncome[section] = (syncedIncome[section] || 0) + amount;
      totalTaxableIncome += amount;
    }
  }

  return {
    syncedIncome,
    transactionsBySection,
    exemptTransactions,
    totalTaxableIncome,
    totalExemptIncome,
  };
}

export function aggregateTransactionsToIncome(
  transactions: Array<{
    type: string;
    category: string;
    amount: number;
    id?: string;
    date?: string;
    time?: string;
    account?: string;
    note?: string;
  }>
): IncomeBySection {
  return categorizeTransactionsForTax(transactions).syncedIncome;
}

export function serializeExcludedTransactionIds(ids?: string[]): string {
  if (!ids || !Array.isArray(ids)) {
    return JSON.stringify([]);
  }
  return JSON.stringify(ids.map(String));
}

export function deserializeExcludedTransactionIds(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      return [];
    }
  }
  return [];
}
