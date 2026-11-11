import { NextResponse } from 'next/server';
import { adjustAccountBalance, BalanceAdjustmentError, isCardAccount } from '@/lib/db/balance-adjustment';

// Signed-in only, like every /api route that is not a webhook or cron (see src/proxy.ts).
// The body names the account only: the amount is recomputed from the database under the ledger lock.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!isCardAccount(body?.account)) {
      return NextResponse.json({ error: 'กรุณาระบุบัญชี K PLUS หรือ Make by KBank' }, { status: 400 });
    }

    const { transaction, gap } = await adjustAccountBalance(body.account);
    return NextResponse.json({ success: true, transaction, gap });
  } catch (error: unknown) {
    if (error instanceof BalanceAdjustmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error adjusting balance:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to adjust balance' },
      { status: 500 },
    );
  }
}
