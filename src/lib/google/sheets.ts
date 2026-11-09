import { google } from 'googleapis';
import { getGoogleAuth } from './auth';
import { CATEGORIES_SHEET, SHEET_TAX, SUMMARY_SHEET, TAX_HEADERS, TRANSACTIONS_SHEET } from '@/lib/sheet-mirror/cells';
import type { Cell, SheetGateway, ValueRender } from '@/lib/sheet-mirror/worker';

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

export async function getSheetsClient() {
  const auth = getGoogleAuth();
  // A hung request must fail and back off, not hold the mirror lock forever
  return google.sheets({ version: 'v4', auth, timeout: 60_000 });
}

export function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error('GOOGLE_SHEET_ID is not configured in environment variables');
  }
  return id;
}

// The Sheet is a read-only mirror of Postgres. Only lib/sheet-mirror talks to it, through createSheetGateway.

/**
 * Initializes the Google Sheet with tabs, human-readable headers, and default categories if not already present.
 */
async function ensureSheetStructure() {
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

let taxSheetVerified = false;

/**
 * Ensures the '📑 ข้อมูลภาษี' tab exists in Google Sheets with appropriate headers.
 */
async function ensureTaxSheetExists(): Promise<void> {
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

/** The Google Sheets calls the background mirror makes */
export function createSheetGateway(): SheetGateway {
  return {
    ensureStructure: async () => {
      await ensureSheetStructure();
      await ensureTaxSheetExists();
    },
    getValues: async (range: string, render: ValueRender = 'FORMATTED_VALUE') => {
      const sheets = await getSheetsClient();
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range, valueRenderOption: render });
      return (res.data.values || []) as Cell[][];
    },
    updateValues: async data => {
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    },
    appendValues: async (range, values) => {
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.append({
        spreadsheetId: getSpreadsheetId(),
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
    },
    clearValues: async range => {
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.clear({ spreadsheetId: getSpreadsheetId(), range });
    },
    deleteRows: async (tab, rowNumbers) => {
      const sheets = await getSheetsClient();
      const spreadsheetId = getSpreadsheetId();
      const metadata = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetId = metadata.data.sheets?.find(s => s.properties?.title === tab)?.properties?.sheetId;
      if (sheetId === undefined || sheetId === null) throw new Error(`Tab ${tab} not found`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          // Bottom row first so one deletion cannot shift the next
          requests: [...rowNumbers].sort((a, b) => b - a).map(row => ({
            deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } },
          })),
        },
      });
    },
  };
}
