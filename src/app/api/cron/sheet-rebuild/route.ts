import { NextResponse } from 'next/server';
import { hasValidSecret } from '@/lib/auth/secret';
import { getJob, startJob } from '@/lib/sync/jobs';
import { rebuildSheet } from '@/lib/sheet-mirror/worker';
import { createSheetGateway } from '@/lib/google/sheets';

/** Rewrites the Sheet from Postgres, for repair. POST starts it in the background; GET ?jobId= reports it. */
export async function POST(req: Request) {
  if (!hasValidSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const job = startJob('sheet-rebuild', () => rebuildSheet(createSheetGateway()));
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
