import { listSlipsInFolder, downloadFileAsBase64 } from '@/lib/google/drive';
import { analyzeSlipImage } from '@/lib/ai/gemini-slip-ocr';
import { appendTransactionRows, ensureSheetStructure } from '@/lib/google/sheets';
import { getProcessedSlipIds, getProcessedSlipMd5s, markSlipProcessed } from '@/lib/db';
import { SyncStats, Transaction } from '@/types';

// Chunk helper for high-speed parallel processing
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const results: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    results.push(array.slice(i, i + chunkSize));
  }
  return results;
}

/**
 * Scans the configured Drive slip folders, OCRs new slips with Gemini and appends them to the sheet.
 */
export async function syncSlipsFromDrive() {
  // 1. Ensure sheet tabs & headers exist
  await ensureSheetStructure();

  const kplusFolderId = process.env.GOOGLE_DRIVE_KPLUS_FOLDER_ID;
  const makeFolderId = process.env.GOOGLE_DRIVE_MAKE_FOLDER_ID;
  const paotangFolderId = process.env.GOOGLE_DRIVE_PAOTANG_FOLDER_ID;

  if (!kplusFolderId && !makeFolderId && !paotangFolderId) {
    throw new Error('No Google Drive slip folders are configured');
  }

  // Prioritize Make by KBank and Paotang first
  const foldersToScan = [
    { id: makeFolderId, account: 'Make by KBank' },
    { id: paotangFolderId, account: 'เป๋าตัง' },
    { id: kplusFolderId, account: 'K PLUS' },
  ].filter((f): f is { id: string; account: string } => Boolean(f.id));

  const stats: SyncStats = {
    processed: 0,
    skipped: 0,
    failed: 0,
    transfers: 0,
    details: [],
  };

  const CONCURRENCY = 6; // Process 6 slips in parallel
  const seenSignatures = new Set<string>();

  for (const folder of foldersToScan) {
    console.log(`[Sync] Scanning folder: ${folder.account}...`);
    const files = await listSlipsInFolder(folder.id);

    const processedIds = await getProcessedSlipIds(files.map(f => f.id));
    const unprocessedFiles = files.filter(f => !processedIds.has(f.id));
    stats.skipped += (files.length - unprocessedFiles.length);

    // Deduplicate by md5 against database and within batch
    const md5sToCheck = unprocessedFiles.map(f => f.md5Checksum).filter(Boolean) as string[];
    const processedMd5s = await getProcessedSlipMd5s(md5sToCheck);

    const seenMd5s = new Set<string>();
    const dedupedFiles: typeof unprocessedFiles = [];

    for (const file of unprocessedFiles) {
      if (file.md5Checksum) {
        if (processedMd5s.has(file.md5Checksum) || seenMd5s.has(file.md5Checksum)) {
          console.log(`[Sync] Skipping duplicate MD5 slip: ${file.name} (${file.md5Checksum})`);
          await markSlipProcessed({
            driveFileId: file.id,
            account: folder.account,
            md5Checksum: file.md5Checksum,
            status: 'DUPLICATE_IGNORED',
          });
          stats.skipped++;
          continue;
        }
        seenMd5s.add(file.md5Checksum);
      }
      dedupedFiles.push(file);
    }

    console.log(`[Sync] ${folder.account}: ${files.length} total, ${dedupedFiles.length} new to process`);

    const fileChunks = chunkArray(dedupedFiles, CONCURRENCY);

    for (const chunk of fileChunks) {
      const chunkTransactions: Transaction[] = [];

      await Promise.all(
        chunk.map(async (file) => {
          try {
            const { base64, mimeType } = await downloadFileAsBase64(file.id);
            const slipData = await analyzeSlipImage(base64, mimeType, folder.account);

            // Ignore non-slip images, QR generation screens, or zero-amount items
            if (!slipData.amount || slipData.amount <= 0) {
              console.log(`[Sync] Ignored non-slip / zero-amount image: ${file.name}`);
              await markSlipProcessed({
                driveFileId: file.id,
                account: folder.account,
                amount: 0,
                transactionDate: slipData.date,
                status: 'IGNORED_ZERO',
              });
              return;
            }

            const sig = `${slipData.date}|${slipData.time}|${slipData.amount}|${folder.account}`;
            if (seenSignatures.has(sig)) {
              console.log(`[Sync] Skipping duplicate slip with identical signature: ${file.name} (${sig})`);
              await markSlipProcessed({
                driveFileId: file.id,
                account: folder.account,
                amount: slipData.amount,
                transactionDate: slipData.date,
                md5Checksum: file.md5Checksum,
                status: 'DUPLICATE_IGNORED',
              });
              stats.skipped++;
              return;
            }
            seenSignatures.add(sig);

            if (slipData.isSelfTransfer) {
              stats.transfers++;
            }

            const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const slipLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

            const newTx: Transaction = {
              id: txId,
              date: slipData.date,
              time: slipData.time,
              type: slipData.type,
              amount: slipData.amount,
              category: slipData.category,
              account: folder.account,
              note: slipData.note,
              slipUrl: slipLink,
              driveFileId: file.id,
              source: 'AUTO_SYNC',
              createdAt: new Date().toISOString(),
            };

            chunkTransactions.push(newTx);

            await markSlipProcessed({
              driveFileId: file.id,
              account: folder.account,
              amount: slipData.amount,
              transactionDate: slipData.date,
              md5Checksum: file.md5Checksum,
              status: 'SUCCESS',
            });

            stats.processed++;
            stats.details.push({
              fileName: file.name,
              account: folder.account,
              amount: slipData.amount,
              status: 'SUCCESS',
            });
          } catch (err: any) {
            stats.failed++;
            console.error(`[Sync] Error on ${file.name}:`, err.message);
            await markSlipProcessed({
              driveFileId: file.id,
              account: folder.account,
              status: 'FAILED',
            });
          }
        })
      );

      // Save batch to Google Sheets periodically
      if (chunkTransactions.length > 0) {
        await appendTransactionRows(chunkTransactions);
      }
    }
  }

  return {
    success: true,
    message: `ซิงค์สลิปสำเร็จ: ประมวลผลใหม่ ${stats.processed} สลิป (โอนระหว่างบัญชี ${stats.transfers}), ข้าม ${stats.skipped}, ล้มเหลว ${stats.failed}`,
    stats,
  };
}
