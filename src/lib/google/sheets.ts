import { google } from 'googleapis';
import { getGoogleAuth } from './auth';
import { Transaction, TransactionType } from '@/types';
import type {
  TaxCalculationResult,
  TaxDeductions,
  IncomeBySection,
  SavedTaxProfile,
} from '@/lib/tax/tax-types';
import {
  serializeExcludedTransactionIds,
  deserializeExcludedTransactionIds,
} from '@/lib/tax/category-mapping';
import { defaultDeductions } from '@/lib/tax/tax-engine';
import { normalizeDateString, normalizeTimeString } from '@/lib/utils/date';
import { isLineSourced } from '@/lib/statement/import-plan';
import { rowFingerprint, type DeleteOp, type UpdateOp } from '@/lib/line/reconcile';

const TRANSACTIONS_SHEET = '📝 รายการทั้งหมด';
const SUMMARY_SHEET = '📊 สรุปยอด';
const CATEGORIES_SHEET = '🏷️ หมวดหมู่';
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

const DEFAULT_CATEGORIES = [
  'อาหารและเครื่องดื่ม',
  'ของใช้ในบ้าน/ซูเปอร์',
  'การเดินทาง/ค่าน้ำมัน',
  'ช้อปปิ้ง',
  'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)',
  'บันเทิง/สตรีมมิ่ง',
  'สุขภาพ/ยา',
  'โอนระหว่างบัญชี',
  'เงินเดือน/รายรับ',
  'อื่นๆ',
];

export { normalizeDateString, normalizeTimeString };

export async function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

export function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error('GOOGLE_SHEET_ID is not configured in environment variables');
  }
  return id;
}

/**
 * Initializes the Google Sheet with tabs, human-readable headers, and default categories if not already present.
 */
export async function ensureSheetStructure() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = metadata.data.sheets?.map(s => s.properties?.title) || [];

  const requests: any[] = [];

  // Add sheets if missing
  if (!existingSheets.includes(SUMMARY_SHEET)) {
    requests.push({ addSheet: { properties: { title: SUMMARY_SHEET } } });
  }
  if (!existingSheets.includes(TRANSACTIONS_SHEET)) {
    requests.push({ addSheet: { properties: { title: TRANSACTIONS_SHEET } } });
  }
  if (!existingSheets.includes(CATEGORIES_SHEET)) {
    requests.push({ addSheet: { properties: { title: CATEGORIES_SHEET } } });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // Populate Transactions header if empty
  const txHeaderCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A1:K1`,
  });

  if (!txHeaderCheck.data.values || txHeaderCheck.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TRANSACTIONS_SHEET}'!A1:K1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            'วันที่',
            'เวลา',
            'ประเภท',
            'จำนวนเงิน',
            'หมวดหมู่',
            'บัญชี',
            'รายละเอียด / ร้านค้า',
            'สลิป',
            'รหัสรายการ',
            'Drive File ID',
            'ที่มา',
          ],
        ],
      },
    });
  }

  // Populate Categories if empty
  const catCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CATEGORIES_SHEET}'!A1:A`,
  });

  // Populate Summary sheet if empty
  const summaryCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SUMMARY_SHEET}'!A1:A5`,
  });

  if (!summaryCheck.data.values || summaryCheck.data.values.length === 0) {
    const summaryRows = [
      ['📊 สรุปภาพรวมการเงิน (Financial Summary)', '', ''],
      ['อัปเดตอัตโนมัติแบบ Real-time เชื่อมต่อกับทุกรายการ', '', ''],
      ['', '', ''],
      ['💰 ภาพรวมกระแสเงินสด', 'จำนวนเงิน (บาท)', ''],
      ['🟢 รายรับทั้งหมด (Total Income)', "='📝 รายการทั้งหมด'!C:C", ''],
      ['🔴 รายจ่ายทั้งหมด (Total Expense)', "='📝 รายการทั้งหมด'!C:C", ''],
      ['💰 คงเหลือสุทธิ (Net Balance)', '=B5-B6', ''],
      ['🔄 เงินโอนระหว่างบัญชี (Transfers)', "='📝 รายการทั้งหมด'!C:C", ''],
      ['', '', ''],
      ['🏦 สรุปรายจ่ายแยกตามบัญชี', 'จำนวนเงิน (บาท)', 'สัดส่วน %'],
      ['🔵 K PLUS', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "K PLUS") + SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "*กสิกร*")', '=B11/B6'],
      ['🟡 Make by KBank', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "Make by KBank") + SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "*Make*")', '=B12/B6'],
      ['📲 เป๋าตัง (Paotang)', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "เป๋าตัง") + SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "*Paotang*")', '=B13/B6'],
      ['💵 เงินสด (Cash)', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "เงินสด") + SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!F:F, "*Cash*")', '=B14/B6'],
      ['', '', ''],
      ['🏷️ สรุปค่าใช้จ่ายแยกตามหมวดหมู่', 'ยอดรวม (บาท)', 'สัดส่วน %'],
      ['อาหารและเครื่องดื่ม', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A17)', '=B17/B6'],
      ['ของใช้ในบ้าน/ซูเปอร์', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A18)', '=B18/B6'],
      ['การเดินทาง/ค่าน้ำมัน', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A19)', '=B19/B6'],
      ['ช้อปปิ้ง', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A20)', '=B20/B6'],
      ['สาธารณูปโภค (น้ำ/ไฟ/เน็ต)', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A21)', '=B21/B6'],
      ['บันเทิง/สตรีมมิ่ง', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A22)', '=B22/B6'],
      ['สุขภาพ/ยา', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A23)', '=B23/B6'],
      ['อื่นๆ', '=SUMIFS(\'📝 รายการทั้งหมด\'!D:D, \'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!E:E, A24)', '=B24/B6'],
    ];

    summaryRows[4][1] = '=SUMIF(\'📝 รายการทั้งหมด\'!C:C, "*รายรับ*", \'📝 รายการทั้งหมด\'!D:D)';
    summaryRows[5][1] = '=SUMIF(\'📝 รายการทั้งหมด\'!C:C, "*รายจ่าย*", \'📝 รายการทั้งหมด\'!D:D)';
    summaryRows[7][1] = '=SUMIF(\'📝 รายการทั้งหมด\'!C:C, "*โอนย้าย*", \'📝 รายการทั้งหมด\'!D:D)';

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SUMMARY_SHEET}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: summaryRows },
    });
  }
}

/**
 * Retrieves all Drive File IDs currently recorded in Google Sheets (Column J)
 */
export async function getExistingDriveFileIds(): Promise<Set<string>> {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${TRANSACTIONS_SHEET}'!J2:J`,
    });

    const rows = response.data.values || [];
    const ids = new Set<string>();
    for (const r of rows) {
      if (r[0] && String(r[0]).trim()) {
        ids.add(String(r[0]).trim());
      }
    }
    return ids;
  } catch (err: any) {
    console.error('[Sheets] Error getting existing drive file ids:', err.message);
    return new Set<string>();
  }
}

/** Columns A-K of a transaction row */
function transactionToCells(tx: Omit<Transaction, 'createdAt' | 'source'> & { source: string }): Array<string | number> {
  // Create human friendly emoji prefix for type
  let typeLabel: string = tx.type;
  if (tx.type === 'EXPENSE') typeLabel = '🔴 รายจ่าย';
  else if (tx.type === 'INCOME') typeLabel = '🟢 รายรับ';
  else if (tx.type === 'TRANSFER') typeLabel = '🔄 โอนย้ายเงิน';

  // Format slip link formula for easy viewing in Google Sheets app
  const slipFormula = tx.slipUrl
    ? `=HYPERLINK("${tx.slipUrl}", "🖼️ ดูสลิป")`
    : '-';

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

/**
 * Appends a new transaction row to Google Sheets
 */
export async function appendTransactionRow(tx: Transaction) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Deduplication safety check for slips
  if (tx.driveFileId && tx.driveFileId.trim()) {
    const existingIds = await getExistingDriveFileIds();
    if (existingIds.has(tx.driveFileId.trim())) {
      console.log(`[Sheets] Slip ${tx.driveFileId} already exists in sheet, skipping append.`);
      return;
    }
  }

  const row = transactionToCells(tx);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });
}

/**
 * Appends multiple transaction rows in a single batch API call with deduplication
 */
export async function appendTransactionRows(txs: Transaction[]) {
  if (txs.length === 0) return;

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Deduplication guard: filter out any transactions whose driveFileId already exists in Google Sheets
  const existingIds = await getExistingDriveFileIds();
  const validTxs = txs.filter(tx => {
    if (tx.driveFileId && tx.driveFileId.trim()) {
      return !existingIds.has(tx.driveFileId.trim());
    }
    return true;
  });

  if (validTxs.length === 0) {
    console.log('[Sheets] All transactions in batch already exist in sheet, skipping append.');
    return;
  }

  // Deduplicate within the batch itself by (date, time, amount, account)
  const batchSignatures = new Set<string>();
  const dedupedTxs: Transaction[] = [];
  for (const tx of validTxs) {
    const cDate = normalizeDateString(tx.date);
    const cTime = normalizeTimeString(tx.time);
    const sig = `${cDate}|${cTime}|${tx.amount}|${tx.account}`;
    // Two equal LINE rows in one minute are two real cards (they differ by balance)
    if (batchSignatures.has(sig) && !isLineSourced(tx.source)) {
      console.log(`[Sheets] Duplicate transaction in batch detected, skipping: ${sig}`);
      continue;
    }
    batchSignatures.add(sig);
    dedupedTxs.push(tx);
  }

  if (dedupedTxs.length === 0) return;

  const rows = dedupedTxs.map(transactionToCells);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows,
    },
  });
}

/** One row of A2:K as a Transaction; `index` is its position in that range */
function rowToTransaction(r: any[], index: number): Transaction {
  const rawType = r[2] || '';
  let parsedType: TransactionType = 'EXPENSE';
  if (rawType.includes('รายรับ') || rawType === 'INCOME') parsedType = 'INCOME';
  else if (rawType.includes('โอนย้าย') || rawType === 'TRANSFER') parsedType = 'TRANSFER';

  // Parse amount cleanly
  const rawAmount = String(r[3] || '0').replace(/[^\d.-]/g, '');
  const amount = parseFloat(rawAmount) || 0;

  let slipUrl: string | undefined = undefined;
  if (r[7] && String(r[7]).startsWith('http')) {
    slipUrl = String(r[7]);
  } else if (r[9] && String(r[9]).trim().length > 10) {
    slipUrl = `https://drive.google.com/file/d/${String(r[9]).trim()}/view`;
  }

  const cleanDate = normalizeDateString(r[0] || '');
  const cleanTime = normalizeTimeString(r[1] || '');

  return {
    id: r[8] || `tx_${index + 1}`,
    date: cleanDate,
    time: cleanTime,
    type: parsedType,
    amount,
    category: r[4] || 'อื่นๆ',
    account: r[5] || 'ไม่ระบุ',
    note: r[6] || '',
    slipUrl,
    driveFileId: r[9] || undefined,
    source: (r[10] as any) || 'MANUAL',
    createdAt: `${cleanDate}T${cleanTime}`,
  };
}

/**
 * Reads all transaction rows from the Google Sheet
 */
export async function getAllTransactions(): Promise<Transaction[]> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A2:K`,
  });

  const rows = response.data.values || [];
  const transactions: Transaction[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0 || !r[0]) continue;
    transactions.push(rowToTransaction(r, i));
  }

  // Sort strictly descending by date & time (newest / latest transactions first)
  transactions.sort((a, b) => {
    const dtA = `${a.date}T${a.time}`;
    const dtB = `${b.date}T${b.time}`;
    const timeA = new Date(dtA).getTime();
    const timeB = new Date(dtB).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return dtB.localeCompare(dtA);
  });

  return transactions;
}

/**
 * Reads the rows again and pairs each id with its current row. Rows shift (appends, deletes, the
 * dedupe rewrite), so a row is only ever addressed through a fresh lookup by id. Throws if a
 * row is gone or differs from what the plan was made from, so nothing is written on stale data.
 */
async function locateRowsForWrite(ops: Array<{ id: string; expected: string }>) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A2:K`,
  });
  const rows = res.data.values || [];
  const indexById = new Map(rows.map((r, i) => [String(r[8] || '').trim(), i]));

  const located = ops.map(op => {
    const index = indexById.get(op.id);
    if (index === undefined) throw new Error(`Sheet row ${op.id} is gone; not written`);
    if (rowFingerprint(rowToTransaction(rows[index], index)) !== op.expected) {
      throw new Error(`Sheet row ${op.id} changed since it was read; not written`);
    }
    return { ...op, index };
  });
  return { sheets, spreadsheetId, located };
}

/** Rewrites rows in place, each found by id right before the write */
export async function updateRowsById(ops: UpdateOp[]): Promise<void> {
  if (ops.length === 0) return;
  const { sheets, spreadsheetId, located } = await locateRowsForWrite(
    ops.map(op => ({ id: op.row.id, expected: op.expected })),
  );
  const cellsById = new Map(ops.map(op => [op.row.id, transactionToCells(op.row)]));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: located.map(({ id, index }) => ({
        range: `'${TRANSACTIONS_SHEET}'!A${index + 2}:K${index + 2}`,
        values: [cellsById.get(id)!],
      })),
    },
  });
}

/** Deletes rows found by id, bottom row first so one deletion cannot shift the next */
export async function deleteRowsById(ops: DeleteOp[]): Promise<void> {
  if (ops.length === 0) return;
  const { sheets, spreadsheetId, located } = await locateRowsForWrite(ops);

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = metadata.data.sheets?.find(s => s.properties?.title === TRANSACTIONS_SHEET)?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error('Transactions sheet not found');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [...located].sort((a, b) => b.index - a.index).map(({ index }) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: index + 1, endIndex: index + 2 },
        },
      })),
    },
  });
}

/**
 * Deletes a transaction row from Google Sheets by transaction ID
 * (Defaults to allowing deletion only for MANUAL transactions)
 */
export async function deleteTransactionRow(txId: string, onlyManual: boolean = true): Promise<{ success: boolean; error?: string }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const txSheet = metadata.data.sheets?.find(s => s.properties?.title === TRANSACTIONS_SHEET);
  if (!txSheet || txSheet.properties?.sheetId === undefined) return { success: false, error: 'Sheet not found' };
  const sheetId = txSheet.properties.sheetId;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!I2:K`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => (r[0] || '').trim() === txId.trim());

  if (rowIndex === -1) {
    return { success: false, error: 'ไม่พบรายการที่ต้องการลบใน Google Sheets' };
  }

  const source = (rows[rowIndex][2] || '').trim();
  if (onlyManual && source !== 'MANUAL') {
    return { success: false, error: 'สามารถลบได้เฉพาะรายการที่บันทึกด้วยตนเองเท่านั้น' };
  }

  // Row 2 in sheets corresponds to startRowIndex: rowIndex + 1 (0-indexed)
  const actualRowIndex = rowIndex + 1;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: actualRowIndex,
              endIndex: actualRowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return { success: true };
}

/**
 * Updates note / comment description on any transaction row in Google Sheets
 */
export async function updateTransactionNote(txId: string, note: string): Promise<boolean> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!I2:I`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => (r[0] || '').trim() === txId.trim());

  if (rowIndex === -1) {
    return false;
  }

  // Row 2 in sheets corresponds to sheet row number: rowIndex + 2
  const sheetRowNum = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!G${sheetRowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[note]],
    },
  });

  return true;
}

/**
 * Updates an entire manual transaction row in Google Sheets
 */
export async function updateManualTransaction(tx: {
  id: string;
  type?: TransactionType;
  amount?: number;
  category?: string;
  account?: string;
  note?: string;
  date?: string;
  time?: string;
}): Promise<{ success: boolean; error?: string }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A2:K`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => (r[8] || '').trim() === tx.id.trim());

  if (rowIndex === -1) {
    return { success: false, error: 'ไม่พบรายการที่ต้องการแก้ไขใน Google Sheets' };
  }

  const existingRow = rows[rowIndex];
  const source = (existingRow[10] || '').trim();

  // If not manual and updating more than note, prevent full overwrite
  if (source !== 'MANUAL' && (tx.amount !== undefined || tx.type !== undefined || tx.account !== undefined)) {
    return { success: false, error: 'รายการที่ซิงค์อัตโนมัติสามารถแก้ไขได้เฉพาะรายละเอียด/หมายเหตุเท่านั้น' };
  }

  let typeLabel: string = existingRow[2] || '🔴 รายจ่าย';
  if (tx.type) {
    if (tx.type === 'EXPENSE') typeLabel = '🔴 รายจ่าย';
    else if (tx.type === 'INCOME') typeLabel = '🟢 รายรับ';
    else if (tx.type === 'TRANSFER') typeLabel = '🔄 โอนย้ายเงิน';
  }

  const updatedDate = normalizeDateString(tx.date ?? existingRow[0]);
  const updatedTime = normalizeTimeString(tx.time ?? existingRow[1]);
  const updatedAmount = tx.amount !== undefined ? tx.amount : existingRow[3];
  const updatedCategory = tx.category ?? existingRow[4];
  const updatedAccount = tx.account ?? existingRow[5];
  const updatedNote = tx.note !== undefined ? tx.note : existingRow[6];

  const sheetRowNum = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A${sheetRowNum}:G${sheetRowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        updatedDate,
        updatedTime,
        typeLabel,
        updatedAmount,
        updatedCategory,
        updatedAccount,
        updatedNote,
      ]],
    },
  });

  return { success: true };
}

/**
 * Scans Google Sheets, removes all duplicate transactions, and rewrites clean unique rows.
 * Also synchronizes unique driveFileIds into SQLite cache.
 */
export async function deduplicateSheetTransactions(): Promise<{ beforeCount: number; afterCount: number; removedCount: number }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TRANSACTIONS_SHEET}'!A1:K`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const allRows = res.data.values || [];
  if (allRows.length <= 1) {
    return { beforeCount: 0, afterCount: 0, removedCount: 0 };
  }

  const dataRows = allRows.slice(1);
  const seenDriveFileIds = new Set<string>();
  const seenExact = new Set<string>();
  const uniqueRows: any[][] = [];
  const validDriveIds: string[] = [];
  let dupCount = 0;

  for (const row of dataRows) {
    const date = (row[0] || '').trim();
    const time = (row[1] || '').trim();
    const type = (row[2] || '').trim();
    const rawAmount = (row[3] || '').replace(/[^\d.-]/g, '');
    const amount = parseFloat(rawAmount) || 0;
    const category = (row[4] || '').trim();
    const account = (row[5] || '').trim();
    const note = (row[6] || '').trim();
    const txId = (row[8] || '').trim();
    const driveFileId = (row[9] || '').trim();
    const source = (row[10] || '').trim();

    let isDuplicate = false;

    // Check Drive File ID uniqueness
    if (driveFileId) {
      if (seenDriveFileIds.has(driveFileId)) {
        isDuplicate = true;
      } else {
        seenDriveFileIds.add(driveFileId);
      }
    }

    // Check exact match (date + time + amount + account). Not for LINE rows: their time has minute
    // precision, so two equal purchases in one minute look identical but are two real cards.
    const exactKey = `${date}|${time}|${amount}|${account}`;
    if (!isDuplicate && !isLineSourced(source)) {
      if (seenExact.has(exactKey)) {
        isDuplicate = true;
      } else {
        seenExact.add(exactKey);
      }
    }

    if (isDuplicate) {
      dupCount++;
      continue;
    }

    let slipVal = row[7] || '-';
    if (driveFileId && driveFileId.length > 10) {
      slipVal = `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "🖼️ ดูสลิป")`;
      validDriveIds.push(driveFileId);
    }

    uniqueRows.push([
      date,
      time,
      type,
      amount,
      category,
      account,
      note,
      slipVal,
      txId,
      driveFileId,
      source,
    ]);
  }

  if (dupCount > 0) {
    // 1. Clear old data rows A2:K
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${TRANSACTIONS_SHEET}'!A2:K`,
    });

    // 2. Rewrite clean deduplicated rows
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TRANSACTIONS_SHEET}'!A2:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: uniqueRows,
      },
    });
  }

  return {
    beforeCount: dataRows.length,
    afterCount: uniqueRows.length,
    removedCount: dupCount,
  };
}

export const getTransactions = getAllTransactions;

export type { SavedTaxProfile };

function parseNumber(value: any): number {
  if (value === undefined || value === null || value === '') return 0;
  const clean = String(value).replace(/[^\d.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Converts a TaxCalculationResult and TaxDeductions into a row matching TAX_HEADERS.
 */
export function taxProfileToRow(
  taxResult: TaxCalculationResult,
  deductions: TaxDeductions,
  year: number = new Date().getFullYear(),
  excludedTransactionIds: string[] = []
): any[] {
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

/**
 * Parses a row from '📑 ข้อมูลภาษี' into a SavedTaxProfile.
 */
export function rowToTaxProfile(row: any[], fallbackYear?: number): SavedTaxProfile | null {
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
    } catch (err: any) {
      console.warn('[Sheets] Failed to parse saved deductions JSON:', err?.message || err);
    }
  }

  const withholdingTax = parseNumber(row[18]);
  const excludedTransactionIds = deserializeExcludedTransactionIds(row[22]);

  return {
    year,
    income,
    deductions,
    withholdingTax,
    excludedTransactionIds,
  };
}

let taxSheetVerified = false;

/**
 * Ensures the '📑 ข้อมูลภาษี' tab exists in Google Sheets with appropriate headers.
 */
export async function ensureTaxSheetExists(): Promise<void> {
  if (taxSheetVerified) {
    return;
  }

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = metadata.data.sheets?.map(s => s.properties?.title) || [];

  if (!existingSheets.includes(SHEET_TAX)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_TAX,
              },
            },
          },
        ],
      },
    });
  }

  // Populate headers if empty or extend if new columns exist
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_TAX}'!A1:W1`,
  });

  if (!headerCheck.data.values || headerCheck.data.values.length === 0 || !headerCheck.data.values[0] || headerCheck.data.values[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TAX}'!A1:W1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [TAX_HEADERS],
      },
    });
  } else if (headerCheck.data.values[0].length < TAX_HEADERS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TAX}'!A1:W1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [TAX_HEADERS],
      },
    });
  }

  taxSheetVerified = true;
}

/**
 * Retrieves the saved tax profile for a given tax year from '📑 ข้อมูลภาษี'.
 * Returns null if not found or if the sheet is empty.
 */
export async function getTaxProfile(year: number): Promise<SavedTaxProfile | null> {
  await ensureTaxSheetExists();

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_TAX}'!A2:W`,
  });

  const rows = response.data.values || [];
  const targetYearStr = String(year);

  const matchedRow = rows.find(r => {
    if (!r || r.length === 0 || !r[0]) return false;
    const cleanYear = String(r[0]).replace(/[^\d]/g, '');
    return cleanYear === targetYearStr;
  });

  if (!matchedRow) {
    return null;
  }

  return rowToTaxProfile(matchedRow, year);
}

/**
 * Upserts the tax profile for a given tax year into '📑 ข้อมูลภาษี'.
 * Updates existing row if found, otherwise appends a new row.
 */
export async function saveTaxProfile(
  taxResult: TaxCalculationResult,
  deductions: TaxDeductions,
  year: number = new Date().getFullYear(),
  excludedTransactionIds?: string[]
): Promise<void> {
  await ensureTaxSheetExists();

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_TAX}'!A2:W`,
  });

  const rows = response.data.values || [];
  const targetYearStr = String(year);

  const rowIndex = rows.findIndex(r => {
    if (!r || r.length === 0 || !r[0]) return false;
    const cleanYear = String(r[0]).replace(/[^\d]/g, '');
    return cleanYear === targetYearStr;
  });

  let finalExcludedIds = excludedTransactionIds;
  if (finalExcludedIds === undefined && rowIndex !== -1 && rows[rowIndex]?.[22]) {
    finalExcludedIds = deserializeExcludedTransactionIds(rows[rowIndex][22]);
  }

  const rowData = taxProfileToRow(taxResult, deductions, year, finalExcludedIds || []);

  if (rowIndex !== -1) {
    // Row 2 is 0-indexed in `rows`, so sheet row number is rowIndex + 2
    const sheetRowNum = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_TAX}'!A${sheetRowNum}:W${sheetRowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_TAX}'!A:W`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });
  }
}


