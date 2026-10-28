import { NextResponse } from 'next/server';
import { syncSlipsFromDrive } from '@/lib/sync/slips';
import { syncStatementsFromEmail } from '@/lib/statement/email-sync';
import { startJob, getJob } from '@/lib/sync/jobs';

/** Starts a slip + statement sync in the background and returns its job id right away. */
export async function POST() {
  const job = startJob('sync-all', async (setStage) => {
    setStage('slips');
    const slips = await syncSlipsFromDrive();
    setStage('statements');
    const statements = await syncStatementsFromEmail();
    return { slips, statements };
  });

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
