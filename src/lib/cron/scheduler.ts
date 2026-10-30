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
