import { ensureSheetStructure, getExistingDriveFileIds } from '@/lib/google/sheets';
import { markSlipsProcessedBatch } from '@/lib/db';
import { syncStatementsFromEmail } from '@/lib/statement/email-sync';
import { syncSlipsFromDrive } from '@/lib/sync/slips';
import { syncMortgageReceiptsFromEmail } from '@/lib/ghb/sync';
import { startJob } from '@/lib/sync/jobs';

/**
 * Executes a full synchronization of Slips, e-Statements and GH Bank mortgage receipts
 */
export async function executeFullSync(setStage: (stage: string) => void = () => {}) {
  const startTime = Date.now();
  console.log(`[Auto-Sync] 🔄 Starting high-speed background sync at ${new Date().toISOString()}...`);

  await ensureSheetStructure();

  // Auto-hydrate DB cache from Google Sheets so fresh pods/restarts never re-process old slips
  try {
    const sheetDriveIds = await getExistingDriveFileIds();
    if (sheetDriveIds.size > 0) {
      await markSlipsProcessedBatch(Array.from(sheetDriveIds));
      console.log(`[Auto-Sync] 🛡️ Hydrated PostgreSQL with ${sheetDriveIds.size} existing slips from Google Sheets.`);
    }
  } catch (err: any) {
    console.error('[Auto-Sync] Warning: Failed to hydrate slip cache from sheets:', err.message);
  }

  // 1. Sync slips from Drive (OCR + MD5/signature dedup)
  setStage('slips');
  let slips: Awaited<ReturnType<typeof syncSlipsFromDrive>>['stats'] | null = null;
  let slipsError: string | undefined;
  try {
    slips = (await syncSlipsFromDrive()).stats;
  } catch (err: any) {
    slipsError = err.message;
    console.error('[Auto-Sync] Error syncing slips:', err.message);
  }

  // 2. Sync Statements from Email (with Slip-First Deduplication)
  setStage('statements');
  let stmResult: any = { skipped: true };
  try {
    stmResult = await syncStatementsFromEmail();
  } catch (err: any) {
    console.error('[Auto-Sync] Error syncing statements from email:', err.message);
  }

  // 3. Sync GH Bank mortgage receipts from Email (only emails not seen before are downloaded)
  setStage('mortgage');
  let mortgage: { added: number; errors: string[] } = { added: 0, errors: [] };
  try {
    mortgage = await syncMortgageReceiptsFromEmail();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mortgage = { added: 0, errors: [message] };
    console.error('[Auto-Sync] Error syncing mortgage receipts from email:', message);
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[Auto-Sync] ✅ Finished in ${durationMs}ms: Slips new=${slips?.processed ?? 0}, skipped=${slips?.skipped ?? 0}, Statement=${stmResult.skipped ? 'cached' : 'updated'}, Mortgage new=${mortgage.added}`
  );

  return {
    success: true,
    timestamp: new Date().toISOString(),
    durationMs,
    slips: {
      processed: slips?.processed ?? 0,
      skipped: slips?.skipped ?? 0,
      failed: slips?.failed ?? 0,
      transfers: slips?.transfers ?? 0,
    },
    slipsError,
    statement: stmResult,
    mortgage,
  };
}

export const FULL_SYNC_JOB = 'sync-all';

/**
 * Starts executeFullSync as a background job. Every entry point (sync button, scheduler, cron)
 * goes through this, so only one sync touches Drive/Sheets at a time; if one is already running
 * its job is returned instead of starting another.
 */
export function startFullSyncJob() {
  return startJob(FULL_SYNC_JOB, executeFullSync);
}
