import { NextResponse } from 'next/server';
import { startFullSyncJob } from '@/lib/sync/runner';
import { waitForJob } from '@/lib/sync/jobs';
import { hasValidSecret } from '@/lib/auth/secret';

export async function GET(req: Request) {
  try {
    if (!hasValidSecret(req, process.env.CRON_SECRET)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const job = await waitForJob(startFullSyncJob().id);
    if (job?.status === 'error') {
      return NextResponse.json({ error: job.error }, { status: 500 });
    }
    return NextResponse.json(job?.result);
  } catch (error: any) {
    console.error('Cron Sync Error:', error);
    return NextResponse.json(
      { error: error.message || 'Cron sync failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
