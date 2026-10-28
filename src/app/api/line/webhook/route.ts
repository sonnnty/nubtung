import { NextResponse } from 'next/server';
import { validateSignature } from '@line/bot-sdk';
import { handleLineEvent } from '@/lib/line/bot';

export async function POST(req: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = req.headers.get('x-line-signature');
  const rawBody = await req.text();

  if (!channelSecret || !signature || !validateSignature(rawBody, channelSecret, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
    const events = body.events || [];

    for (const event of events) {
      await handleLineEvent(event);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('LINE Webhook Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process LINE webhook' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'LINE Webhook is active' });
}
