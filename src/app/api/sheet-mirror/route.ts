import { NextResponse } from 'next/server';
import { getSheetMirrorHealth } from '@/lib/sheet-mirror/worker';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getSheetMirrorHealth());
  } catch (error: unknown) {
    console.error('Error reading Sheet mirror status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read Sheet mirror status' },
      { status: 500 }
    );
  }
}
