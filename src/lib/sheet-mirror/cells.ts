// How rows look on the Google Sheet: the mapping both ways, kept free of Google and Postgres.
// No `@/` imports here: this module is loaded directly by the node test runner.
import type { Transaction } from '../../types/index.ts';
import type { TaxCalculationResult, TaxDeductions, IncomeBySection, SavedTaxProfile } from '../tax/tax-types.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { serializeExcludedTransactionIds, deserializeExcludedTransactionIds } from '../tax/category-mapping.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { defaultDeductions } from '../tax/tax-engine.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { normalizeDateString, normalizeTimeString } from '../utils/date.ts';

export const TRANSACTIONS_SHEET = '📝 รายการทั้งหมด';
export const SUMMARY_SHEET = '📊 สรุปยอด';
export const CATEGORIES_SHEET = '🏷️ หมวดหมู่';
export const SHEET_TAX = '📑 ข้อมูลภาษี';

export const TAX_HEADERS = [
  'ปีภาษี',
  'เงินได้พึงประเมินรวม',
  '40(1) เงินเดือน',
  '40(2) ฟรีแลนซ์/รับจ้าง',
  '40(3) ค่าลิขสิทธิ์',
  '40(4) ดอกเบี้ย/ปันผล',
  '40(5) ค่าเช่า',
  '40(6) วิชาชีพอิสระ',
  '40(7) รับเหมา',
  '40(8) อื่นๆ/ธุรกิจ',
  'ค่าใช้จ่ายที่หักได้',
  'ลดหย่อนตนเองและครอบครัว',
  'ลดหย่อนประกันและการออม',
  'ลดหย่อนกองทุนเกษียณและThaiESG',
  'ลดหย่อนอสังหาฯและมาตรการรัฐ',
  'เงินบริจาคที่หักได้',
  'เงินได้สุทธิ',
  'ภาษีที่คำนวณได้',
  'ภาษีหัก ณ ที่จ่าย',
  'ภาษีที่ต้องจ่ายเพิ่ม (คืน)',
  'รายละเอียดค่าลดหย่อน (JSON)',
  'อัปเดตล่าสุด',
  'รายการที่ผู้ใช้ยกเว้น (JSON)',
];

/** Columns A-K of a transaction row, exactly as the app has always written them */
export function transactionToCells(tx: Omit<Transaction, 'createdAt' | 'source'> & { source: string }): Array<string | number> {
  let typeLabel: string = tx.type;
  if (tx.type === 'EXPENSE') typeLabel = '🔴 รายจ่าย';
  else if (tx.type === 'INCOME') typeLabel = '🟢 รายรับ';
  else if (tx.type === 'TRANSFER') typeLabel = '🔄 โอนย้ายเงิน';

  const slipFormula = tx.slipUrl ? `=HYPERLINK("${tx.slipUrl}", "🖼️ ดูสลิป")` : '-';

  return [
    normalizeDateString(tx.date),
    normalizeTimeString(tx.time),
    typeLabel,
    tx.amount,
    tx.category,
    tx.account,
    tx.note,
    slipFormula,
    tx.id,
    tx.driveFileId || '',
    tx.source,
  ];
}

function parseNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const clean = String(value).replace(/[^\d.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/** A TaxCalculationResult and TaxDeductions as a row matching TAX_HEADERS */
export function taxProfileToRow(
  taxResult: TaxCalculationResult,
  deductions: TaxDeductions,
  year: number = new Date().getFullYear(),
  excludedTransactionIds: string[] = [],
): Array<string | number> {
  const retirementAndThaiEsg =
    (taxResult.deductionsBreakdown?.retirementGroup || 0) +
    (taxResult.deductionsBreakdown?.thaiEsg || 0);

  return [
    year,
    taxResult.totalIncome ?? 0,
    taxResult.incomeBySection?.section40_1 ?? 0,
    taxResult.incomeBySection?.section40_2 ?? 0,
    taxResult.incomeBySection?.section40_3 ?? 0,
    taxResult.incomeBySection?.section40_4 ?? 0,
    taxResult.incomeBySection?.section40_5 ?? 0,
    taxResult.incomeBySection?.section40_6 ?? 0,
    taxResult.incomeBySection?.section40_7 ?? 0,
    taxResult.incomeBySection?.section40_8 ?? 0,
    taxResult.totalDeductibleExpenses ?? 0,
    taxResult.deductionsBreakdown?.personalFamily ?? 0,
    taxResult.deductionsBreakdown?.insuranceSavings ?? 0,
    retirementAndThaiEsg,
    taxResult.deductionsBreakdown?.propertyEconomy ?? 0,
    taxResult.deductionsBreakdown?.donations ?? 0,
    taxResult.netTaxableIncome ?? 0,
    taxResult.finalTax ?? 0,
    taxResult.withholdingTax ?? 0,
    taxResult.netTaxPayable ?? 0,
    JSON.stringify(deductions),
    new Date().toISOString(),
    serializeExcludedTransactionIds(excludedTransactionIds),
  ];
}

/** A row of the tax tab as a SavedTaxProfile */
export function rowToTaxProfile(row: unknown[], fallbackYear?: number): SavedTaxProfile | null {
  if (!row || row.length === 0 || row[0] === undefined || row[0] === null || String(row[0]).trim() === '') {
    return null;
  }

  const cleanYear = String(row[0]).replace(/[^\d]/g, '');
  const parsedYear = parseInt(cleanYear, 10);
  const year = isNaN(parsedYear) ? (fallbackYear ?? new Date().getFullYear()) : parsedYear;

  const income: IncomeBySection = {
    section40_1: parseNumber(row[2]),
    section40_2: parseNumber(row[3]),
    section40_3: parseNumber(row[4]),
    section40_4: parseNumber(row[5]),
    section40_5: parseNumber(row[6]),
    section40_6: parseNumber(row[7]),
    section40_7: parseNumber(row[8]),
    section40_8: parseNumber(row[9]),
  };

  let deductions: TaxDeductions = { ...defaultDeductions };
  if (row[20]) {
    try {
      const parsed = typeof row[20] === 'string' ? JSON.parse(row[20]) : row[20];
      if (typeof parsed === 'object' && parsed !== null) {
        deductions = { ...defaultDeductions, ...parsed };
      }
    } catch (err: unknown) {
      console.warn('[Sheet mirror] Failed to parse saved deductions JSON:', err instanceof Error ? err.message : err);
    }
  }

  const withholdingTax = parseNumber(row[18]);
  const excludedTransactionIds = deserializeExcludedTransactionIds(row[22] as string | undefined);

  return { year, income, deductions, withholdingTax, excludedTransactionIds };
}
