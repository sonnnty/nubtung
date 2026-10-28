let syncIntervalTimer: NodeJS.Timeout | null = null;
let emailSyncTimer: NodeJS.Timeout | null = null;
let isEmailSyncRunning = false;

/**
 * Calculates milliseconds until the next occurrence of targetHour (0-23).
 * If targetHour has already passed today (or is right now), schedules for tomorrow.
 */
export function getMillisecondsUntilNextHour(
  targetHour: number = 4,
  now: Date = new Date()
): number {
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Executes daily synchronization of GH Bank mortgage receipts from email.
 */
export async function executeDailyEmailSync(): Promise<{ added: number; errors: string[] }> {
  if (isEmailSyncRunning) {
    console.log('[Scheduler] 📧 Email sync is already running, skipping...');
    return { added: 0, errors: ['Previous email sync still running'] };
  }

  isEmailSyncRunning = true;
  console.log('[Scheduler] 📧 Starting daily GH Bank mortgage receipts email sync...');

  try {
    let syncMod: any;
    try {
      // @ts-expect-error - node test runner requires .ts extension for ESM strip-types
      syncMod = await import('../ghb/sync.ts');
    } catch {
      syncMod = await import('@/lib/ghb/sync');
    }
    const { syncMortgageReceiptsFromEmail } = syncMod;
    const res = await syncMortgageReceiptsFromEmail();
    console.log(`[Scheduler] 📧 Daily email sync completed. Added ${res.added} new mortgage receipt(s).`);
    if (res.errors && res.errors.length > 0) {
      console.warn('[Scheduler] 📧 Warnings/Errors during email sync:', res.errors);
    }
    return res;
  } catch (err: any) {
    console.error('[Scheduler] 📧 Error during daily email sync:', err.message);
    return { added: 0, errors: [err.message] };
  } finally {
    isEmailSyncRunning = false;
  }
}

/**
 * Schedules daily email sync at targetHour (default 04:00 AM local time).
 */
export function startDailyEmailSyncScheduler(targetHour: number = 4) {
  const enabled = process.env.ENABLE_DAILY_EMAIL_SYNC !== 'false';
  if (!enabled) {
    console.log('[Scheduler] 📧 Daily email sync is disabled via ENABLE_DAILY_EMAIL_SYNC=false');
    return;
  }

  const pass = (process.env.GHB_EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!pass) {
    console.log('[Scheduler] 📧 Daily email sync skipped: GHB_EMAIL_APP_PASSWORD is not set.');
    return;
  }

  if (emailSyncTimer) {
    clearTimeout(emailSyncTimer);
  }

  const scheduleNext = () => {
    const delayMs = getMillisecondsUntilNextHour(targetHour);
    const nextRunDate = new Date(Date.now() + delayMs);
    console.log(
      `[Scheduler] 📧 Next daily GH Bank email sync scheduled at ${nextRunDate.toLocaleString('th-TH')} (in ${Math.round(
        delayMs / 1000 / 60
      )} mins)`
    );

    emailSyncTimer = setTimeout(async () => {
      try {
        await executeDailyEmailSync();
      } catch (err: any) {
        console.error('[Scheduler] 📧 Scheduled daily email sync failed:', err.message);
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  // Run initial email sync after 30 seconds on startup
  setTimeout(async () => {
    try {
      console.log('[Scheduler] 📧 Running initial startup GH Bank email sync check...');
      await executeDailyEmailSync();
    } catch (err: any) {
      console.error('[Scheduler] 📧 Initial email sync failed:', err.message);
    }
  }, 30000);

  scheduleNext();
}

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
 * Initializes Background Auto-Sync for Slips, Statements, and Daily GH Bank Receipts.
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

  // Periodic background execution for Slips and Statements
  syncIntervalTimer = setInterval(() => runScheduledSync('scheduled'), intervalMs);

  // Initial sync after 15 seconds on startup
  setTimeout(() => runScheduledSync('startup'), 15000);

  // Initialize Daily Email Sync Scheduler
  const targetHour = parseInt(process.env.DAILY_EMAIL_SYNC_HOUR || '4', 10);
  startDailyEmailSyncScheduler(targetHour);
}
