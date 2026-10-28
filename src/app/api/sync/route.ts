import { NextResponse } from 'next/server';
import { startFullSyncJob } from '@/lib/sync/runner';
import { getJob } from '@/lib/sync/jobs';

/** Starts a slip + statement sync in the background and returns its job id right away. */
export async function POST() {
  const job = startFullSyncJob();

  return NextResponse.json({ jobId: job.id, status: job.status, stage: job.stage }, { status: 202 });
}

/** Polls a sync job: GET /api/sync?jobId=... */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId');
  const job = jobId ? getJob(jobId) : undefined;
  if (!job) {
    return NextResponse.json({ error: 'ไม่พบงานซิงค์นี้ (อาจเพราะเซิร์ฟเวอร์รีสตาร์ท)' }, { status: 404 });
  }
  return NextResponse.json(job);
}
