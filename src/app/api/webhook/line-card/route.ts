import { NextResponse } from 'next/server';
import { hasValidSecret } from '@/lib/auth/secret';
import { ingestCard } from '@/lib/line/ingest';
import { ledgerStore } from '@/lib/line/store';
import type { RawCard } from '@/lib/line/kbank-card';

/**
 * One card of the LINE chat "KBank Live", posted by the phone bridge:
 * { title, date, account, amount, balance, messageId? } with the card's text as shown on screen.
 *
 * A card that cannot be understood is recorded for review and answered 200: retrying won't help.
 * Failures to write are answered 500, so the phone retries; a retried card adds nothing.
 */
export async function POST(req: Request) {
  if (!hasValidSecret(req, process.env.WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  try {
    const result = await ingestCard(body as RawCard, ledgerStore);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('LINE card webhook error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Card processing failed' },
      { status: 500 }
    );
  }
}
