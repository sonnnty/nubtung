import { NextResponse } from 'next/server';
import { hasValidSecret } from '@/lib/auth/secret';
import { getJob, startJob } from '@/lib/sync/jobs';
import { runSheetMigration } from '@/lib/sheet-mirror/migrate';
import { createSheetGateway } from '@/lib/google/sheets';

/**
 * The one-time import of the Google Sheet into Postgres. POST starts it in the background (it can
 * take longer than the reverse proxy allows a request) and returns the job id; GET ?jobId= reports it.
 */
export async function POST(req: Request) {
  if (!hasValidSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const job = startJob('sheet-migrate', () => runSheetMigration(createSheetGateway()));
  return NextResponse.json({ jobId: job.id, status: job.status });
}

export async function GET(req: Request) {
  if (!hasValidSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const job = getJob(new URL(req.url).searchParams.get('jobId') || '');
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json(job, { status: job.status === 'error' ? 500 : 200 });
}
