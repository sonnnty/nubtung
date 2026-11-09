let syncIntervalTimer: NodeJS.Timeout | null = null;

/**
 * Runs a full sync through the shared job lock, so it never overlaps a sync started from the
 * sync button or /api/cron/sync.
 */
async function runScheduledSync(trigger: 'scheduled' | 'startup') {
  try {
    const { startFullSyncJob, FULL_SYNC_JOB } = await import('@/lib/sync/runner');
    const { getRunningJob, waitForJob } = await import('@/lib/sync/jobs');
    if (getRunningJob(FULL_SYNC_JOB)) {
      console.log(`[Scheduler] A sync is already running, skipping ${trigger} sync...`);
      return;
    }
    console.log(`[Scheduler] Running ${trigger} sync...`);
    const job = await waitForJob(startFullSyncJob().id);
    if (job?.status === 'error') {
      console.error(`[Scheduler] Error during ${trigger} sync:`, job.error);
    }
  } catch (err: any) {
    console.error(`[Scheduler] Error during ${trigger} sync:`, err.message);
  }
}

/**
 * Initializes Background Auto-Sync for Slips, Statements and GH Bank mortgage receipts.
 */
export function startBackgroundSyncScheduler() {
  const enabled = process.env.ENABLE_BACKGROUND_SYNC !== 'false';
  if (!enabled) {
    console.log('[Scheduler] Background auto-sync is disabled via ENABLE_BACKGROUND_SYNC=false');
    return;
  }

  const intervalMinutes = parseInt(process.env.AUTO_SYNC_INTERVAL_MINUTES || '60', 10);
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  console.log(`[Scheduler] 🚀 Initializing Background Auto-Sync every ${intervalMinutes} minutes (default: 60 mins)...`);

  // Clear existing timer if any
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
  }

  // Periodic background execution for Slips, Statements and mortgage receipts
  syncIntervalTimer = setInterval(() => runScheduledSync('scheduled'), intervalMs);

  // Initial sync after 15 seconds on startup
  setTimeout(() => runScheduledSync('startup'), 15000);
}

const globalForMirror = globalThis as unknown as { __nubtangSheetMirrorTimer?: NodeJS.Timeout };
let mirrorTickRunning = false;

/** Failures of the Sheet are recorded by the worker; this catches Postgres and programming errors */
async function runMirrorTick() {
  if (mirrorTickRunning) return;
  mirrorTickRunning = true;
  try {
    const [{ mirrorOnce }, { createSheetGateway }] = await Promise.all([
      import('@/lib/sheet-mirror/worker'),
      import('@/lib/google/sheets'),
    ]);
    await mirrorOnce(createSheetGateway());
  } catch (err: unknown) {
    console.error('[Scheduler] Sheet mirror tick failed:', err instanceof Error ? err.message : err);
  } finally {
    mirrorTickRunning = false;
  }
}

/**
 * Starts the background worker that keeps the Google Sheet a copy of Postgres. It runs regardless of
 * the auto-sync setting: writes keep landing in the outbox even when slip syncing is off.
 */
export function startSheetMirrorScheduler() {
  if (process.env.ENABLE_SHEET_MIRROR === 'false') {
    console.log('[Scheduler] Sheet mirror is disabled via ENABLE_SHEET_MIRROR=false');
    return;
  }

  const intervalSeconds = Math.max(1, parseInt(process.env.SHEET_MIRROR_INTERVAL_SECONDS || '5', 10) || 5);
  if (globalForMirror.__nubtangSheetMirrorTimer) {
    clearInterval(globalForMirror.__nubtangSheetMirrorTimer);
  }
  globalForMirror.__nubtangSheetMirrorTimer = setInterval(runMirrorTick, intervalSeconds * 1000);
  console.log(`[Scheduler] Sheet mirror running every ${intervalSeconds}s`);
}
