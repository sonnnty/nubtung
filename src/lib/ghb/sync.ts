import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { saveMortgagePayment, getMortgageAccounts, getMortgagePayments, calculateRemainingBalanceFromHistory } from '../db/mortgage.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { getProcessedStatementIds, markStatementProcessed } from '../db/index.ts';

export interface ParsedReceipt {
  accountNo: string;
  dateStr: string;
  yearCE: number;
  month: number;
  interest: number;
  principal: number;
  fee: number;
  totalPaid: number;
  remainingBalance?: number;
}

export interface GhbReceipt {
  uid: number;
  filename: string;
  accountNo: string;
  date: string; // YYYY-MM-DD
  yearCE: number;
  month: number; // 1-12
  interest: number;
  principal: number;
  fee: number;
  totalPaid: number;
  remainingBalance?: number;
}

export interface GhbSyncResult {
  success: boolean;
  totalInterest: number;
  receiptCount: number;
  receipts: GhbReceipt[];
  error?: string;
}

const THAI_MONTHS: Record<string, number> = {
  'มกราคม': 1,
  'กุมภาพันธ์': 2,
  'มีนาคม': 3,
  'เมษายน': 4,
  'พฤษภาคม': 5,
  'มิถุนายน': 6,
  'กรกฎาคม': 7,
  'สิงหาคม': 8,
  'กันยายน': 9,
  'ตุลาคม': 10,
  'พฤศจิกายน': 11,
  'ธันวาคม': 12,
};

/**
 * Derives PDF passwords based on STATEMENT_PASSWORD env var or defaults.
 * GH Bank PDFs use 6-digit Buddhist Era date of birth (ววดดปป).
 * e.g., '15042000' (15 Apr 2000 / 2543 BE) -> '150443'
 */
function getPasswordCandidates(): string[] {
  const stmPw = process.env.STATEMENT_PASSWORD || '';
  const candidates: string[] = [];

  if (stmPw) {
    candidates.push(stmPw);
    // If DDMMYYYY (8 digits)
    if (stmPw.length === 8) {
      const d = stmPw.slice(0, 2);
      const m = stmPw.slice(2, 4);
      const y = parseInt(stmPw.slice(4), 10);
      if (!isNaN(y)) {
        // Buddhist Era 2-digit year
        const beYear2 = String(y + 543).slice(-2);
        candidates.push(`${d}${m}${beYear2}`);
      }
    }
  }

  // Fallback to verified password if not already present
  if (!candidates.includes('150443')) {
    candidates.push('150443');
  }

  return candidates;
}

/**
 * Extracts receipt information from a decrypted GH Bank PDF text.
 */
export function parseGhbReceiptText(text: string): ParsedReceipt | null {
  // Check if this is indeed a GHB receipt
  if (!text.includes('ธนาคารอาคารสงเคราะห์') && !text.includes('ghbank') && !text.includes('ใบเสร็จรับเงินอิเล็กทรอนิกส์')) {
    return null;
  }

  // Account number: เลขที่บัญชี 011690010482
  const accountMatch = text.match(/เลขที่บัญชี\s+(\d+)/);
  const accountNo = accountMatch ? accountMatch[1] : '';

  // Date: วันที่      27 กรกฎาคม 2569
  const dateMatch = text.match(/วันที่\s+(\d{1,2})\s+([ก-๙]+)\s+(\d{4})/);
  let dateStr = '';
  let yearCE = 0;
  let month = 0;
  let day = 0;

  if (dateMatch) {
    day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2];
    const yearBE = parseInt(dateMatch[3], 10);
    yearCE = yearBE - 543;
    month = THAI_MONTHS[monthName] || 0;
    dateStr = `${yearCE}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Total paid: จำนวนเงินที่ชำระ  *****600.00 บาท
  const totalMatch = text.match(/จำนวนเงินที่ชำระ\s+\**([\d,]+\.\d{2})/);
  const totalPaid = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;

  // Breakdown line under columns: ค่าประกันอัคคีภัย / ดอกเบี้ย / เงินต้น
  // Example: 0.00                                180.74                           419.26
  const rowMatch = text.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  let fee = 0;
  let interest = 0;
  let principal = 0;

  if (rowMatch) {
    fee = parseFloat(rowMatch[1].replace(/,/g, ''));
    interest = parseFloat(rowMatch[2].replace(/,/g, ''));
    principal = parseFloat(rowMatch[3].replace(/,/g, ''));
  }

  // Remaining balance:
  // 1. Table layout in GH Bank electronic receipt PDF:
  // ค่าประกันอัคคีภัย /
  // ค่าธรรมเนียมอื่นคงเหลือ   ดอกเบี้ยคงเหลือ   เงินต้นคงเหลือ
  // 0.00                     0.00              2,076,961.73
  const tableMatch = text.match(/ดอกเบี้ยคงเหลือ\s+เงินต้นคงเหลือ\s*[\r\n]+\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  let remainingBalance: number | undefined;

  if (tableMatch) {
    remainingBalance = parseFloat(tableMatch[3].replace(/,/g, ''));
  } else {
    // 2. Same-line keyword: เงินต้นคงเหลือ 99,603.74 บาท or ยอดคงเหลือ 2,095,350.00 บาท
    // Use [^\S\r\n]+ to match horizontal spaces only, avoiding multi-line misread
    const lineMatch = text.match(/(?:เงินต้นคงเหลือ|ยอดคงเหลือ)[^\S\r\n]+\**([\d,]+\.\d{2})/);
    if (lineMatch) {
      remainingBalance = parseFloat(lineMatch[1].replace(/,/g, ''));
    }
  }

  return {
    accountNo,
    dateStr,
    yearCE,
    month,
    interest,
    principal,
    fee,
    totalPaid,
    remainingBalance,
  };
}

/**
 * Connects to IMAP, searches for GH Bank receipt emails, downloads and decrypts PDF receipts,
 * saves payments for mortgage accounts (House: 011690010474, MRTA: 011690010482) to database,
 * and recalculates missing remaining balances.
 */
export async function syncMortgageReceiptsFromEmail(): Promise<{ added: number; errors: string[] }> {
  const user = process.env.GHB_EMAIL_USER || 'sonty.tapb@gmail.com';
  const pass = (process.env.GHB_EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!pass) {
    return {
      added: 0,
      errors: ['ยังไม่ได้ตั้งค่า GHB_EMAIL_APP_PASSWORD ใน Environment Variables'],
    };
  }

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

  const passwords = getPasswordCandidates();
  const errors: string[] = [];
  let added = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    const validAccounts = new Set(['011690010474', '011690010482']);
    const parsedReceipts: Array<ParsedReceipt & { uid: number }> = [];
    // Emails are remembered by UID so the hourly full sync only downloads new ones
    const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : '0';
    const emailFileId = (uid: number) => `ghb_email_${uidValidity}_${uid}`;
    const newUids: number[] = [];
    const failedUids = new Set<number>();

    try {
      const searchResult = await client.search({
        or: [
          { from: 'ghbank.co.th' },
          { from: 'ghb-receipt-noreply@ghbank.co.th' },
          { from: 'worachotw.43@gmail.com' },
          { body: 'ghbank' },
        ],
      }, { uid: true });

      const allUids = Array.isArray(searchResult) ? searchResult : [];
      const processedIds = await getProcessedStatementIds(allUids.map(emailFileId));
      newUids.push(...allUids.filter((uid) => !processedIds.has(emailFileId(uid))));

      for (const uid of newUids) {
        try {
          const { content } = await client.download(String(uid), undefined, { uid: true });
          const parsed = await simpleParser(content);

          if (!parsed.attachments || parsed.attachments.length === 0) continue;

          for (const att of parsed.attachments) {
            if (att.filename && att.filename.toLowerCase().endsWith('.pdf')) {
              const tempDir = os.tmpdir();
              const tempFileName = `ghb_${uid}_${Math.random().toString(36).substring(7)}.pdf`;
              const tempPath = path.join(tempDir, tempFileName);

              try {
                fs.writeFileSync(tempPath, att.content);

                let text = '';
                for (const pw of passwords) {
                  try {
                    text = execFileSync('pdftotext', ['-layout', '-upw', pw, tempPath, '-'], {
                      encoding: 'utf-8',
                      stdio: ['pipe', 'pipe', 'ignore'],
                    });
                    if (text && text.length > 50) break;
                  } catch {
                    // Try next password candidate
                  }
                }

                if (text) {
                  const receiptData = parseGhbReceiptText(text);
                  if (receiptData && validAccounts.has(receiptData.accountNo)) {
                    parsedReceipts.push({
                      ...receiptData,
                      uid,
                    });
                  }
                }
              } finally {
                if (fs.existsSync(tempPath)) {
                  try {
                    fs.unlinkSync(tempPath);
                  } catch {}
                }
              }
            }
          }
        } catch (err) {
          const msg = `Failed to process message UID ${uid}: ${err instanceof Error ? err.message : String(err)}`;
          console.warn(`[GHB Mortgage Sync] ${msg}`);
          errors.push(msg);
          failedUids.add(uid);
        }
      }
    } finally {
      lock.release();
    }

    try {
      await client.logout();
    } catch {}

    // Sort parsed receipts by payment date ascending
    parsedReceipts.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    // Save receipts to database
    for (const receipt of parsedReceipts) {
      try {
        const saveRes = await saveMortgagePayment({
          accountId: receipt.accountNo,
          paymentDate: receipt.dateStr,
          totalPaid: receipt.totalPaid,
          principal: receipt.principal,
          interest: receipt.interest,
          fee: receipt.fee,
          remainingBalance: receipt.remainingBalance ?? 0,
          receiptUid: String(receipt.uid),
          source: 'EMAIL_SYNC',
        });
        if (saveRes.inserted) {
          added++;
        }
      } catch (err) {
        const msg = `Failed to save payment for account ${receipt.accountNo} (${receipt.dateStr}): ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[GHB Mortgage Sync] ${msg}`);
        errors.push(msg);
        failedUids.add(receipt.uid);
      }
    }

    // Remember emails handled without errors (including ones with no receipt) so they are not downloaded again
    for (const uid of newUids) {
      if (failedUids.has(uid)) continue;
      try {
        await markStatementProcessed({ fileId: emailFileId(uid), fileName: 'GHB receipt email', modifiedTime: uidValidity });
      } catch (err) {
        console.warn(`[GHB Mortgage Sync] Failed to remember message UID ${uid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Recalculate remaining balances if missing
    try {
      const accounts = await getMortgageAccounts();
      for (const acc of accounts) {
        if (!validAccounts.has(acc.id)) continue;
        const payments = await getMortgagePayments(acc.id);
        if (payments.length === 0) continue;

        let runningBalance = acc.loanAmount;
        for (let i = 0; i < payments.length; i++) {
          const p = payments[i];
          if (p.remainingBalance !== undefined && p.remainingBalance !== null && p.remainingBalance > 0) {
            runningBalance = p.remainingBalance;
          } else {
            runningBalance = calculateRemainingBalanceFromHistory(runningBalance, [{ principal: p.principal }]);
            p.remainingBalance = runningBalance;
            await saveMortgagePayment(p);
          }
        }
      }
    } catch (err) {
      const msg = `Failed to recalculate missing balances: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[GHB Mortgage Sync] ${msg}`);
      errors.push(msg);
    }

    return { added, errors };
  } catch (err: unknown) {
    console.error('[GHB Mortgage Sync] Error connecting to IMAP or processing receipts:', err);
    errors.push(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่ออีเมล');
    return { added, errors };
  }
}

/**
 * Connects to IMAP, searches for GH Bank receipt emails, downloads PDF attachments,
 * decrypts them with poppler-utils `pdftotext`, and parses out home loan interest for the specified tax year.
 */
export async function syncGhbInterestFromEmail(targetYear: number): Promise<GhbSyncResult> {
  const user = process.env.GHB_EMAIL_USER || 'sonty.tapb@gmail.com';
  const pass = (process.env.GHB_EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!pass) {
    return {
      success: false,
      totalInterest: 0,
      receiptCount: 0,
      receipts: [],
      error: 'ยังไม่ได้ตั้งค่า GHB_EMAIL_APP_PASSWORD ใน Environment Variables',
    };
  }

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

  const passwords = getPasswordCandidates();
  const allReceipts: GhbReceipt[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search for emails from ghbank or containing keywords
      const searchResult = await client.search({
        or: [
          { from: 'ghbank.co.th' },
          { from: 'ghb-receipt-noreply@ghbank.co.th' },
          { from: 'worachotw.43@gmail.com' },
          { body: 'ghbank' },
        ],
      });

      const uids = Array.isArray(searchResult) ? searchResult : [];

      for (const uid of uids) {
        try {
          const { content } = await client.download(String(uid));
          const parsed = await simpleParser(content);

          if (!parsed.attachments || parsed.attachments.length === 0) continue;

          for (const att of parsed.attachments) {
            if (att.filename && att.filename.toLowerCase().endsWith('.pdf')) {
              const tempDir = os.tmpdir();
              const tempFileName = `ghb_${uid}_${Math.random().toString(36).substring(7)}.pdf`;
              const tempPath = path.join(tempDir, tempFileName);

              try {
                fs.writeFileSync(tempPath, att.content);

                let text = '';
                for (const pw of passwords) {
                  try {
                    // pdftotext -layout -upw <password> <filepath> -
                    text = execFileSync('pdftotext', ['-layout', '-upw', pw, tempPath, '-'], {
                      encoding: 'utf-8',
                      stdio: ['pipe', 'pipe', 'ignore'], // suppress stderr password errors
                    });
                    if (text && text.length > 50) break;
                  } catch {
                    // Try next password candidate
                  }
                }

                if (text) {
                  const parsedData = parseGhbReceiptText(text);
                  if (parsedData && parsedData.yearCE === targetYear) {
                    allReceipts.push({
                      uid,
                      filename: att.filename,
                      accountNo: parsedData.accountNo,
                      date: parsedData.dateStr,
                      yearCE: parsedData.yearCE,
                      month: parsedData.month,
                      interest: parsedData.interest,
                      principal: parsedData.principal,
                      fee: parsedData.fee,
                      totalPaid: parsedData.totalPaid,
                      remainingBalance: parsedData.remainingBalance,
                    });
                  }
                }
              } finally {
                if (fs.existsSync(tempPath)) {
                  try {
                    fs.unlinkSync(tempPath);
                  } catch {}
                }
              }
            }
          }
        } catch (err) {
          console.warn(`[GHB Sync] Failed to parse message UID ${uid}:`, err);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    // Sort receipts by date ascending
    allReceipts.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate sum of interest
    const totalInterest = Math.round(allReceipts.reduce((sum, r) => sum + r.interest, 0) * 100) / 100;

    return {
      success: true,
      totalInterest,
      receiptCount: allReceipts.length,
      receipts: allReceipts,
    };
  } catch (err: unknown) {
    console.error('[GHB Sync] Error connecting to IMAP or parsing receipts:', err);
    return {
      success: false,
      totalInterest: 0,
      receiptCount: 0,
      receipts: [],
      error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่ออีเมล',
    };
  }
}
