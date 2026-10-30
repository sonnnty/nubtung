import { upsertStatementBalance } from '@/lib/db';
import type { ParsedStatement } from '@/lib/statement/statement-text';

/**
 * Remembers a statement's closing balance (ยอดยกไป) as the dashboard anchor for its account.
 * The newest period wins. A failure is logged, not thrown: the import itself already succeeded.
 */
export async function recordStatementAnchor(account: string, parsed: ParsedStatement, fileId: string): Promise<boolean> {
  const { closingBalance, periodEnd } = parsed.header;
  if (closingBalance === null || !periodEnd) return false;
  try {
    await upsertStatementBalance({ account, periodEnd, closingBalance, fileId });
    return true;
  } catch (err: unknown) {
    console.error(`[Statement] Could not save the closing balance of ${fileId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
