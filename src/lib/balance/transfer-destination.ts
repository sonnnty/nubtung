// Which account a TRANSFER row's money goes to, judged from its note.
// No `@/` imports here: this module is loaded directly by the node test runner.

/**
 * Resolves the receiving account of a TRANSFER row sent from `fromAcc`, or null when the note
 * does not name one (the money then just leaves `fromAcc`).
 */
export function resolveTransferDestination(rawNote: string | undefined, fromAcc: string): string | null {
  const note = (rawNote || '').toLowerCase();
  const paotangAccountNo = (process.env.PAOTANG_ACCOUNT_NO || '9289').toLowerCase();

  let toAcc: string | null = null;
  if (note.includes('ไปยัง k plus') || note.includes('เข้า k plus') || note.includes('to k plus') || note.includes('ฝากเงินเข้า k plus')) {
    toAcc = 'K PLUS';
  } else if (note.includes('ไปยัง make') || note.includes('เข้า make') || note.includes('to make') || note.includes('ฝากเงินเข้า make')) {
    toAcc = 'Make by KBank';
  } else if (note.includes('ไปยัง เป๋าตัง') || note.includes('เข้า เป๋าตัง') || note.includes('to paotang') || note.includes('เติมเงิน g-wallet')) {
    toAcc = 'เป๋าตัง';
  } else if (note.includes('ไปยัง เงินสด') || note.includes('เข้า เงินสด') || note.includes('ถอนเงินสด') || note.includes('to cash') || note.includes('ถอน atm')) {
    toAcc = 'เงินสด';
  } else if (
    note.includes(paotangAccountNo) ||
    note.includes('เป๋าตัง') ||
    note.includes('g-wallet') ||
    note.includes('ktb g-wallet')
  ) {
    toAcc = 'เป๋าตัง';
  } else if (note.includes('2996') || note.includes('make by kbank') || note.includes('make')) {
    toAcc = 'Make by KBank';
  } else if (note.includes('k plus') || note.includes('k+') || (!!process.env.KPLUS_ACCOUNT_NO && note.includes(process.env.KPLUS_ACCOUNT_NO)) || note.includes('กสิกร')) {
    toAcc = 'K PLUS';
  } else if (note.includes('เงินสด') && fromAcc !== 'เงินสด') {
    toAcc = 'เงินสด';
  }

  // Slips between my two KBank accounts often only say "โอนระหว่างบัญชี"; the other side is implied
  if (!toAcc && note.trim() === 'โอนระหว่างบัญชี') {
    if (fromAcc === 'K PLUS') toAcc = 'Make by KBank';
    else if (fromAcc === 'Make by KBank') toAcc = 'K PLUS';
  }

  return toAcc;
}
