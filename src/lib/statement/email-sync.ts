import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { extractStatementText } from '@/lib/statement/parser';
import { parseStatement, checkStatementTotals, periodEndFromStatementFileName, type ParsedStatement } from '@/lib/statement/statement-text';
import { detectStatementAccount, last4FromStatementFileName, last4FromStatementHeader, type StatementAccount } from '@/lib/statement/accounts';
import { planStatementImport } from '@/lib/statement/import-plan';
import { getAllTransactions, appendTransactionRows } from '@/lib/google/sheets';
import { isStatementProcessed, markStatementProcessed, getStatementBalances } from '@/lib/db';
import { recordStatementAnchor } from '@/lib/statement/anchor';
import { Transaction } from '@/types';

export interface StatementEmailSyncResult {
  success: boolean;
  message: string;
  processedFiles: number;
  skippedFiles: number;
  totalStatementTransactions: number;
  matchedWithSlip: number;
  addedFromStatement: number;
  /** Statements for accounts the dashboard doesn't track; skipped, not imported */
  unknownAccountFiles?: string[];
  newTransactions?: Array<{
    date: string;
    amount: number;
    type: string;
    category: string;
    note: string;
  }>;
  skipped?: boolean;
}

interface PendingStatement {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  account: StatementAccount;
  parsed: ParsedStatement;
}

function readStatementText(content: Buffer, passwords: string[]): string | null {
  for (const pw of passwords) {
    try {
      const text = extractStatementText(content, pw);
      if (text.trim()) return text;
    } catch {
      // Try next password
    }
  }
  return null;
}

/**
 * Synchronizes Kasikornbank e-Statements received via email (from K-ElectronicDocument@kasikornbank.com)
 * - The account comes from the file name STM_SA<last4> (or the PDF header); statements of other accounts are skipped.
 * - Slip-First Deduplication per account: a statement row matching an existing row of the same account on
 *   (date, amount) leaves that row as it is. Only unmatched rows (interest, fees, deposits without a slip...)
 *   are added with source='STATEMENT'.
 * - Transfers between my tracked accounts are stored once, on the sending account (see import-plan.ts).
 * - The closing balance of the newest statement per account anchors the dashboard balance.
 */
export async function syncStatementsFromEmail(forceRefresh = false): Promise<StatementEmailSyncResult> {
  const user = process.env.GHB_EMAIL_USER || 'worachotw.43@gmail.com';
  const pass = process.env.GHB_EMAIL_APP_PASSWORD;

  if (!pass) {
    console.warn('[Statement Email Sync] GHB_EMAIL_APP_PASSWORD not set, skipping email sync');
    return {
      success: false,
      message: 'ไม่ได้ตั้งค่ารหัสผ่านอีเมล (GHB_EMAIL_APP_PASSWORD)',
      processedFiles: 0,
      skippedFiles: 0,
      totalStatementTransactions: 0,
      matchedWithSlip: 0,
      addedFromStatement: 0,
    };
  }

  const passwordCandidates = [
    process.env.STATEMENT_PASSWORD,
    '15042000',
  ].filter(Boolean) as string[];

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user,
      pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search for KBank e-Document emails
      const searchResult = await client.search({
        or: [
          { from: 'K-ElectronicDocument@kasikornbank.com' },
          { subject: 'K-eDocument' },
          { subject: 'E-statement for saving account' },
        ],
      });

      const uids = Array.isArray(searchResult) ? searchResult : [];
      if (uids.length === 0) {
        return {
          success: true,
          message: 'ไม่พบอีเมล e-Statement จากกสิกรไทย',
          processedFiles: 0,
          skippedFiles: 0,
          totalStatementTransactions: 0,
          matchedWithSlip: 0,
          addedFromStatement: 0,
        };
      }

      // 1. Fetch all existing transactions to prepare for Slip-First Deduplication
      const existingTransactions = await getAllTransactions();
      
      // Closing balances already stored, to backfill anchors from statements imported before they existed
      const anchorPeriodEnds = new Map<string, string>();
      try {
        for (const anchor of await getStatementBalances()) anchorPeriodEnds.set(anchor.account, anchor.periodEnd);
      } catch (err: unknown) {
        console.error('[Statement Email Sync] Could not read statement balances:', err instanceof Error ? err.message : err);
      }

      let skippedFiles = 0;
      let totalStatementTransactions = 0;
      const unknownAccountFiles: string[] = [];
      const pending: PendingStatement[] = [];

      // Sort UIDs descending to process most recent statements first
      const sortedUids = [...uids].sort((a, b) => b - a);

      for (const uid of sortedUids) {
        try {
          const { content } = await client.download(String(uid));
          const parsed = await simpleParser(content);

          if (!parsed.attachments || parsed.attachments.length === 0) continue;

          for (const att of parsed.attachments) {
            const filename = att.filename || '';
            const isStatementPdf = filename.toLowerCase().endsWith('.pdf') && 
              (filename.startsWith('STM_') || filename.toLowerCase().includes('statement'));

            if (!isStatementPdf) continue;

            const fileId = `email_stm_${filename}`;
            if (pending.some(p => p.fileId === fileId)) continue;

            // Check if already processed
            if (!forceRefresh) {
              const alreadyProcessed = await isStatementProcessed(fileId);
              if (alreadyProcessed) {
                skippedFiles++;
                // Statements imported before closing balances were stored: record the newest one per account
                const account = detectStatementAccount(filename);
                const periodEnd = periodEndFromStatementFileName(filename);
                const known = account ? anchorPeriodEnds.get(account) : undefined;
                if (account && periodEnd && (!known || periodEnd > known)) {
                  const text = readStatementText(att.content, passwordCandidates);
                  if (text && await recordStatementAnchor(account, parseStatement(text, filename), fileId, parsed.date?.toISOString())) {
                    anchorPeriodEnds.set(account, periodEnd);
                  }
                }
                continue;
              }
            }

            const text = readStatementText(att.content, passwordCandidates);
            if (!text) {
              console.warn(`[Statement Email Sync] Could not read ${filename} (wrong password?)`);
              continue;
            }

            const statement = parseStatement(text, filename);
            if (!statement.account) {
              // Never import a statement of an unknown account as K PLUS. Not marked as processed,
              // so it is picked up once KPLUS_ACCOUNT_NO / MAKE_ACCOUNT_NO match it.
              const last4 = last4FromStatementFileName(filename) || last4FromStatementHeader(text) || '?';
              console.warn(`[Statement Email Sync] Skipping ${filename}: account ending ${last4} is not K PLUS or Make by KBank`);
              unknownAccountFiles.push(filename);
              continue;
            }

            if (statement.transactions.length === 0 && statement.header.closingBalance === null) {
              console.warn(`[Statement Email Sync] Could not parse transactions from ${filename}`);
              continue;
            }

            const totalsWarnings = checkStatementTotals(statement);
            if (totalsWarnings.length > 0) {
              console.warn(`[Statement Email Sync] ${filename}: parsed rows differ from the header (${totalsWarnings.join('; ')})`);
            }

            totalStatementTransactions += statement.transactions.length;
            pending.push({
              fileId,
              fileName: filename,
              modifiedTime: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
              account: statement.account,
              parsed: statement,
            });
          }
        } catch (err: any) {
          console.error(`[Statement Email Sync] Error processing message UID ${uid}:`, err.message);
        }
      }

      // Slip-first deduplication against every row in the sheet, per account
      const plan = planStatementImport(
        existingTransactions,
        pending.map(p => ({ account: p.account, transactions: p.parsed.transactions })),
      );
      const now = new Date().toISOString();
      const allNewTransactions: Transaction[] = plan.toAppend.map(row => ({
        id: `stm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ...row,
        source: 'STATEMENT',
        createdAt: now,
      }));
      const matchedWithSlip = plan.matched;
      const addedFromStatement = allNewTransactions.length;

      // Append all genuinely new statement transactions to Google Sheets
      if (allNewTransactions.length > 0) {
        await appendTransactionRows(allNewTransactions);
      }

      // Only after the rows are in the sheet: mark the files and store their closing balances
      for (const p of pending) {
        await markStatementProcessed({
          fileId: p.fileId,
          fileName: p.fileName,
          modifiedTime: p.modifiedTime,
          transactionsCount: p.parsed.transactions.length,
        });
        await recordStatementAnchor(p.account, p.parsed, p.fileId, p.modifiedTime);
      }
      const processedFiles = pending.length;

      const baseMsg = processedFiles > 0
        ? `ซิงค์ e-Statement สำเร็จ: ตรวจพบ ${processedFiles} ไฟล์ (${[...new Set(pending.map(p => p.account))].join(', ')}), รายการตรงกับสลิป ${matchedWithSlip} รายการ (ใช้สลิปเป็นหลัก), บันทึกรายการใหม่เฉพาะ Statement ${addedFromStatement} รายการ`
        : skippedFiles > 0
        ? `e-Statement เป็นปัจจุบันแล้ว (ข้าม ${skippedFiles} ไฟล์ที่เคยประมวลผลแล้ว)`
        : 'ไม่พบไฟล์ e-Statement ใหม่';
      const msg = unknownAccountFiles.length > 0
        ? `${baseMsg} · ข้าม ${unknownAccountFiles.length} ไฟล์ของบัญชีที่ไม่รู้จัก`
        : baseMsg;

      return {
        success: true,
        message: msg,
        processedFiles,
        skippedFiles,
        totalStatementTransactions,
        matchedWithSlip,
        addedFromStatement,
        unknownAccountFiles: unknownAccountFiles.length > 0 ? unknownAccountFiles : undefined,
        skipped: processedFiles === 0 && skippedFiles > 0,
        newTransactions: allNewTransactions.map(tx => ({
          date: tx.date,
          amount: tx.amount,
          type: tx.type,
          category: tx.category,
          note: tx.note,
        })),
      };
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (error: any) {
    console.error('[Statement Email Sync] IMAP error:', error);
    return {
      success: false,
      message: `เกิดข้อผิดพลาดในการเชื่อมต่ออีเมล: ${error.message || error}`,
      processedFiles: 0,
      skippedFiles: 0,
      totalStatementTransactions: 0,
      matchedWithSlip: 0,
      addedFromStatement: 0,
    };
  }
}
