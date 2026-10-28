import { NextResponse } from 'next/server';
import { executeFullSync } from '@/lib/sync/runner';
import { hasValidSecret } from '@/lib/auth/secret';

export async function GET(req: Request) {
  try {
    if (!hasValidSecret(req, process.env.CRON_SECRET)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await executeFullSync();
    return NextResponse.json(result);
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
