import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google/auth';
import { getSpreadsheetId, getSheetsClient } from '@/lib/google/sheets';
import { parseStatementText, parseStatement, checkStatementTotals, type StatementTransaction, type ParsedStatement } from '@/lib/statement/statement-text';
import { last4FromStatementFileName, last4FromStatementHeader } from '@/lib/statement/accounts';
import { reconcileStatementRows, type SheetRow, type StatementImport } from '@/lib/statement/import-plan';
import { recordStatementAnchor } from '@/lib/statement/anchor';

export { parseStatementText, parseStatement, type StatementTransaction } from '@/lib/statement/statement-text';

/** Runs `pdftotext -layout` on a (password-protected) KBank statement PDF and returns its text */
export function extractStatementText(pdfBuffer: Buffer, password?: string): string {
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `stm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`);
  fs.writeFileSync(tempFilePath, pdfBuffer);

  try {
    const args = ['-layout', ...(password ? ['-upw', password] : []), tempFilePath, '-'];
    return execFileSync('pdftotext', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

/** Parses a statement PDF as K PLUS. Kept for callers that only handle K PLUS statements. */
export function parseStatementPdf(pdfBuffer: Buffer, password?: string): StatementTransaction[] {
  return parseStatementText(extractStatementText(pdfBuffer, password));
}

import { isStatementProcessed, markStatementProcessed } from '@/lib/db';

/**
 * Reconciles and synchronizes statement PDFs from Google Drive with Google Sheets.
 * Each statement only rewrites the rows of its own account (K PLUS or Make by KBank, from the
 * file name STM_SA<last4> or the PDF header); rows of every other account are preserved.
 * Statements of an account the dashboard doesn't track are skipped.
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
  const existingRows = (sheetRes.data.values || []) as SheetRow[];

  // 3. Download & parse all statement files, each for its own account
  const statements: StatementImport[] = [];
  const parsedFiles: Array<{ file: (typeof files)[number]; account: string; parsed: ParsedStatement }> = [];
  const unknownAccountFiles: string[] = [];

  for (const file of files) {
    const fileRes = await drive.files.get(
      { fileId: file.id!, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(fileRes.data as ArrayBuffer);
    const text = extractStatementText(buffer, password);
    const parsed = parseStatement(text, file.name || '');

    if (!parsed.account) {
      const last4 = last4FromStatementFileName(file.name || '') || last4FromStatementHeader(text) || '?';
      console.warn(`[Statement Drive Sync] Skipping ${file.name}: account ending ${last4} is not K PLUS or Make by KBank`);
      unknownAccountFiles.push(file.name || file.id!);
      continue;
    }

    const totalsWarnings = checkStatementTotals(parsed);
    if (totalsWarnings.length > 0) {
      console.warn(`[Statement Drive Sync] ${file.name}: parsed rows differ from the header (${totalsWarnings.join('; ')})`);
    }

    statements.push({ account: parsed.account, transactions: parsed.transactions });
    parsedFiles.push({ file, account: parsed.account, parsed });
  }

  // 4-6. Rewrite each statement account's rows; keep its unmatched rows and every other account's rows
  const result = reconcileStatementRows(existingRows, statements);
  const allFinalRows = result.rows;

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

  // 8. Mark statement files as processed and store their closing balances
  for (const { file, account, parsed } of parsedFiles) {
    await markStatementProcessed({
      fileId: file.id!,
      fileName: file.name || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      md5Checksum: file.md5Checksum || undefined,
      transactionsCount: allFinalRows.length,
    });
    await recordStatementAnchor(account, parsed, file.id!);
  }

  const accountSummary = Object.entries(result.perAccount)
    .map(([account, { total, matched }]) => `${account} ทั้งหมด ${total} รายการ (แมตช์สลิป ${matched})`)
    .join(', ');
  const kplus = result.perAccount['K PLUS'];

  return {
    success: true,
    message: `ซิงค์และกระทบยอด Statement สำเร็จ: ${accountSummary || 'ไม่มีรายการ'}`
      + (result.addedTransfers > 0 ? `, เพิ่มรายการโอนฝั่งผู้โอน ${result.addedTransfers} รายการ` : '')
      + `, บัญชีอื่นๆ คงอยู่ครบ ${result.untouched} รายการ`
      + (unknownAccountFiles.length > 0 ? `, ข้าม ${unknownAccountFiles.length} ไฟล์ของบัญชีที่ไม่รู้จัก` : ''),
    total: allFinalRows.length,
    kplusTotal: kplus ? kplus.total : 0,
    perAccount: result.perAccount,
    otherAccountsTotal: result.untouched,
    filesCount: files.length,
    unknownAccountFiles,
  };
}
