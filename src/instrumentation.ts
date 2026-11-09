export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundSyncScheduler, startSheetMirrorScheduler } = await import('@/lib/cron/scheduler');
    startBackgroundSyncScheduler();
    startSheetMirrorScheduler();
  }
}
