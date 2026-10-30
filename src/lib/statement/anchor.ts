import { upsertStatementBalance } from '@/lib/db';
import type { ParsedStatement } from '@/lib/statement/statement-text';
import { getBangkokDateString } from '@/lib/utils/date';

/**
 * A KBank statement ends the day before it is issued. One whose period reaches its issue day
 * would hold only part of that day, so its closing balance cannot anchor the balance: the day's
 * slips would be either dropped (cut-off at period end) or counted twice (cut-off a day earlier).
 */
export function isCompleteStatementPeriod(periodEnd: string, issuedAt?: string): boolean {
  if (!issuedAt) return true;
  const issued = new Date(issuedAt);
  if (isNaN(issued.getTime())) return true;
  return periodEnd < getBangkokDateString(issued);
}

/**
 * Remembers a statement's closing balance (ยอดยกไป) as the dashboard anchor for its account.
 * The newest period wins. A failure is logged, not thrown: the import itself already succeeded.
 */
export async function recordStatementAnchor(
  account: string,
  parsed: ParsedStatement,
  fileId: string,
  issuedAt?: string,
): Promise<boolean> {
  const { closingBalance, periodEnd } = parsed.header;
  if (closingBalance === null || !periodEnd) return false;
  if (!isCompleteStatementPeriod(periodEnd, issuedAt)) {
    console.warn(`[Statement] ${fileId} ends on its issue day (${periodEnd}); not using its closing balance as the anchor`);
    return false;
  }
  try {
    await upsertStatementBalance({ account, periodEnd, closingBalance, fileId });
    return true;
  } catch (err: unknown) {
    console.error(`[Statement] Could not save the closing balance of ${fileId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
