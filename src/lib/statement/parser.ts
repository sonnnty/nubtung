import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google/auth';
import { getSpreadsheetId, getSheetsClient } from '@/lib/google/sheets';

export interface StatementTransaction {
  date: string;
  time: string;
  typeDesc: string;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  category: string;
  channel: string;
  details: string;
  balance?: number;
}

export function parseStatementPdf(pdfBuffer: Buffer, password?: string): StatementTransaction[] {
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `stm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`);
  fs.writeFileSync(tempFilePath, pdfBuffer);

  try {
    const pwArg = password ? `-upw ${password}` : '';
    const stdout = execSync(`pdftotext -layout ${pwArg} "${tempFilePath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    return parseStatementText(stdout);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export function parseStatementText(text: string): StatementTransaction[] {
  const lines = text.split('\n');
  const transactions: StatementTransaction[] = [];
  let currentTx: any = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([^\d\s][^\d]+?)\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s+(.+)$/);

    if (match) {
      if (currentTx) {
        transactions.push(finalizeTx(currentTx));
      }

      const [d, m, y] = match[1].split('-');
      const fullYear = parseInt(y, 10) < 50 ? '20' + y : '19' + y;
      const formattedDate = `${fullYear}-${m}-${d}`;
      const time = `${match[2]}:00`;
      const typeDesc = match[3].trim();
      const val1 = match[4] ? parseFloat(match[4].replace(/,/g, '')) : null;
      const val2 = match[5] ? parseFloat(match[5].replace(/,/g, '')) : null;
      const balance = match[6] ? parseFloat(match[6].replace(/,/g, '')) : undefined;
      const rest = match[7].trim();

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
        date: formattedDate,
        time,
        typeDesc,
        withdrawal,
        deposit,
        balance,
        rawRest: rest,
      };
    } else if (currentTx && /^\s{60,}\S/.test(line)) {
      currentTx.rawRest += ' ' + line.trim();
    }
  }

  if (currentTx) {
    transactions.push(finalizeTx(currentTx));
  }

  return transactions;
}

function finalizeTx(raw: any): StatementTransaction {
  const isDeposit = raw.deposit !== null && raw.deposit > 0;
  const amount = isDeposit ? raw.deposit : (raw.withdrawal || 0);

  const ownNamesConfig = process.env.OWN_ACCOUNT_NAMES || 'วรโชติ,worachot';
  const ownNames = ownNamesConfig.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const detailText = `${raw.typeDesc} ${raw.rawRest}`.toLowerCase();
  let isSelf = false;
  for (const name of ownNames) {
    if (detailText.includes(name)) {
      isSelf = true;
      break;
    }
  }

  // A deposit from one of my own accounts that the dashboard doesn't track (e.g. GHB)
  // is new money for K PLUS. Recording it as TRANSFER makes the balance calc deduct it
  // from K PLUS instead, so keep it as INCOME under the (tax-exempt) transfer category.
  const isFromUntrackedOwnAccount = isSelf && isDeposit && !isFromTrackedAccount(detailText);

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
    channel: 'K PLUS',
    details: `${raw.typeDesc}: ${raw.rawRest}`,
    balance: raw.balance,
  };
}

// Accounts besides K PLUS whose balances the dashboard tracks (Make by KBank, เป๋าตัง)
function isFromTrackedAccount(detailText: string): boolean {
  const makeLast4 = (process.env.MAKE_ACCOUNT_NO || '2996').slice(-4);
  const paotangLast4 = (process.env.PAOTANG_ACCOUNT_NO || '9289').slice(-4);
  return (
    /make by kbank|g-wallet|เป๋าตัง/i.test(detailText) ||
    detailText.includes(`x${makeLast4}`) ||
    detailText.includes(`x${paotangLast4}`)
  );
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

import { isStatementProcessed, markStatementProcessed } from '@/lib/db';

/**
 * Reconciles and synchronizes statement PDFs from Google Drive with Google Sheets
 * Separates K PLUS reconciliation from other accounts (Make by KBank, Cash),
 * strictly preserving all non-K PLUS rows!
 */
export async function syncStatementsFromDrive(forceRefresh = false) {
  const folderId = process.env.GOOGLE_DRIVE_STATEMENT_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_STATEMENT_FOLDER_ID is not set');
  }

  const password = process.env.STATEMENT_PASSWORD || '15042000';

  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // 1. List PDF files in statement folder
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name, modifiedTime, md5Checksum)',
  });

  const files = (res.data.files || []).filter(f => f.name && f.name.startsWith('STM_'));

  if (files.length === 0) {
    return { success: true, message: 'ไม่พบไฟล์ e-Statement ใหม่ใน Google Drive', total: 0 };
  }

  // Check if all files have already been processed and unchanged (Instant skip)
  if (!forceRefresh) {
    const checks = await Promise.all(
      files.map(f => isStatementProcessed(f.id!, f.modifiedTime || undefined))
    );
    const hasNewOrUpdatedFiles = checks.some(processed => !processed);

    if (!hasNewOrUpdatedFiles) {
      return {
        success: true,
        message: 'ไม่มีไฟล์ Statement ใหม่ (ข้ามการประมวลผลซ้ำเพื่อความรวดเร็ว)',
        skipped: true,
        filesCount: files.length,
      };
    }
  }

  // 2. Fetch existing Google Sheet rows
  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'📝 รายการทั้งหมด'!A2:K`,
  });
  const existingRows = sheetRes.data.values || [];

  // Separate K PLUS rows and Other Accounts (Make by KBank, Cash, etc.)
  const otherAccountsRows: any[][] = [];
  const kplusExistingRows: any[][] = [];

  for (const row of existingRows) {
    const account = (row[5] || '').trim();
    if (account === 'K PLUS') {
      kplusExistingRows.push(row);
    } else {
      otherAccountsRows.push(row);
    }
  }

  // Track existing K PLUS slips
  const existingKplusSlipMap = new Map<string, {
    row: any[];
    slipUrl: string;
    id: string;
    driveFileId: string;
    matched: boolean;
  }>();

  for (let idx = 0; idx < kplusExistingRows.length; idx++) {
    const row = kplusExistingRows[idx];
    const rDate = row[0];
    const rAmount = parseFloat(String(row[3] || '0').replace(/[^\d.-]/g, ''));
    const rSlip = row[7];
    const rId = row[8] || `tx_existing_${idx}`;
    const rFileId = row[9] || '';

    if (rDate && !isNaN(rAmount)) {
      const key = `${rDate}_${rAmount.toFixed(2)}`;
      existingKplusSlipMap.set(`${key}_${idx}`, {
        row,
        slipUrl: rSlip,
        id: rId,
        driveFileId: rFileId,
        matched: false,
      });
    }
  }

  // 3. Download & parse all statement files with cross-statement deduplication
  const uniqueStatementMap = new Map<string, StatementTransaction>();

  for (const file of files) {
    const fileRes = await drive.files.get(
      { fileId: file.id!, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(fileRes.data as ArrayBuffer);
    const txs = parseStatementPdf(buffer, password);

    for (const tx of txs) {
      const fingerprint = `${tx.date}_${tx.time}_${tx.amount.toFixed(2)}_${tx.type}_${tx.details.substring(0, 30)}`;
      if (!uniqueStatementMap.has(fingerprint)) {
        uniqueStatementMap.set(fingerprint, tx);
      }
    }
  }

  const allStatementTxs = Array.from(uniqueStatementMap.values());

  // 4. Reconcile K PLUS Statement transactions
  const reconciledKplusRows: any[][] = [];
  let matchedSlipCount = 0;
  let newStatementRowsCount = 0;

  for (let i = 0; i < allStatementTxs.length; i++) {
    const stm = allStatementTxs[i];
    let typeLabel = '🔴 รายจ่าย';
    if (stm.type === 'INCOME') typeLabel = '🟢 รายรับ';
    else if (stm.type === 'TRANSFER') typeLabel = '🔄 โอนย้ายเงิน';

    const baseKey = `${stm.date}_${stm.amount.toFixed(2)}`;

    let matchedEntryKey: string | null = null;
    let matchedSlip: { row: any[]; slipUrl: string; id: string; driveFileId: string; matched: boolean } | null = null;

    for (const [key, entry] of existingKplusSlipMap.entries()) {
      if (key.startsWith(baseKey) && !entry.matched) {
        matchedEntryKey = key;
        matchedSlip = entry;
        break;
      }
    }

    if (matchedSlip && matchedEntryKey) {
      matchedSlip.matched = true;
      matchedSlipCount++;
    } else {
      newStatementRowsCount++;
    }

    const slipFormula = matchedSlip && matchedSlip.slipUrl && matchedSlip.slipUrl !== '-'
      ? matchedSlip.slipUrl
      : '-';

    const txId = matchedSlip && matchedSlip.id ? matchedSlip.id : `stm_${stm.date.replace(/-/g, '')}_${i + 1}`;
    const driveFileId = matchedSlip && matchedSlip.driveFileId ? matchedSlip.driveFileId : '';
    const source = matchedSlip ? 'AUTO_SYNC+STATEMENT' : 'STATEMENT';

    reconciledKplusRows.push([
      stm.date,
      stm.time,
      typeLabel,
      stm.amount,
      stm.category,
      'K PLUS',
      stm.details,
      slipFormula,
      txId,
      driveFileId,
      source,
    ]);
  }

  // 5. Preserve any unmatched K PLUS entries (e.g. unbilled recent slips)
  for (const [, entry] of existingKplusSlipMap.entries()) {
    if (!entry.matched) {
      reconciledKplusRows.push(entry.row);
    }
  }

  // 6. Combine ALL reconciled K PLUS rows + ALL Other Accounts (Make by KBank, Cash)
  const allFinalRows = [...reconciledKplusRows, ...otherAccountsRows];

  // Sort descending by date and time
  allFinalRows.sort((a, b) => {
    const dtA = `${a[0] || ''} ${a[1] || ''}`;
    const dtB = `${b[0] || ''} ${b[1] || ''}`;
    return dtB.localeCompare(dtA);
  });

  // 7. Update Google Sheets
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'📝 รายการทั้งหมด'!A2:K`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'📝 รายการทั้งหมด'!A2:K${allFinalRows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: allFinalRows,
    },
  });

  // 8. Mark all statement files as processed in database cache
  for (const file of files) {
    await markStatementProcessed({
      fileId: file.id!,
      fileName: file.name || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      md5Checksum: file.md5Checksum || undefined,
      transactionsCount: allFinalRows.length,
    });
  }

  return {
    success: true,
    message: `ซิงค์และกระทบยอด Statement สำเร็จ: K PLUS ทั้งหมด ${reconciledKplusRows.length} รายการ (แมตช์สลิป ${matchedSlipCount}), บัญชีอื่นๆ (Make/เงินสด) คงอยู่ครบ ${otherAccountsRows.length} รายการ`,
    total: allFinalRows.length,
    kplusTotal: reconciledKplusRows.length,
    otherAccountsTotal: otherAccountsRows.length,
    filesCount: files.length,
  };
}
