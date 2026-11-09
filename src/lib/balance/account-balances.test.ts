import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { computeAccountBalances, computeAccountBalancesWithCards, BASELINE_BALANCES } from './account-balances.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseStatement } from '../statement/statement-text.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { planStatementImport } from '../statement/import-plan.ts';
import type { BalanceCard, BalanceTransaction } from './account-balances.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';
const PAOTANG = 'เป๋าตัง';
const MAKE_ANCHOR = { account: MAKE, periodEnd: '2026-10-29', closingBalance: 757.83 };

const tx = (
  date: string,
  type: BalanceTransaction['type'],
  amount: number,
  account: string,
  note = '',
  time?: string,
): BalanceTransaction => ({ date, time, type, amount, account, note });

const card = (account: string, date: string, time: string, balance: number, seq = 1): BalanceCard =>
  ({ account, date, time, balance, seq });

before(() => {
  process.env.OWN_ACCOUNT_NAMES = 'สมชาย';
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
  delete process.env.PAOTANG_ACCOUNT_NO;
});

describe('computeAccountBalances without anchors (unchanged baseline logic)', () => {
  it('starts from the 2026-09-04 baseline and applies rows from that day on', () => {
    const { balances, asOf } = computeAccountBalances([
      tx('2026-09-03', 'EXPENSE', 999, KPLUS),
      tx('2026-09-04', 'EXPENSE', 53.07, KPLUS),
      tx('2026-09-10', 'INCOME', 100, MAKE),
      tx('2026-09-11', 'TRANSFER', 1000, KPLUS, 'โอนไป X2996'),
      tx('2026-09-12', 'TRANSFER', 300, MAKE, 'โอนไป KTB X9289'),
      tx('2026-09-13', 'TRANSFER', 200, KPLUS, 'โอนระหว่างบัญชี'),
    ]);
    assert.deepStrictEqual(asOf, {});
    assert.strictEqual(balances[KPLUS], 43253.07 - 53.07 - 1000 - 200);
    assert.strictEqual(balances[MAKE], Math.round((3672.29 + 100 + 1000 - 300 + 200) * 100) / 100);
    assert.strictEqual(balances[PAOTANG], Math.round((195.44 + 300) * 100) / 100);
    assert.strictEqual(balances['เงินสด'], 0);
  });
});

describe('computeAccountBalances with statement anchors', () => {
  it('starts an anchored account from the closing balance and only applies later rows', () => {
    const { balances, asOf } = computeAccountBalances([
      tx('2026-10-15', 'EXPENSE', 500, MAKE),
      tx('2026-10-29', 'EXPENSE', 427, MAKE),
      tx('2026-10-30', 'EXPENSE', 32, MAKE),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[MAKE], 725.83);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });
    // other accounts keep the baseline
    assert.strictEqual(balances[KPLUS], BASELINE_BALANCES[KPLUS]);
  });

  it('a transfer before the receiver anchor only affects the sender', () => {
    const { balances } = computeAccountBalances([
      tx('2026-10-08', 'TRANSFER', 1000, KPLUS, 'โอนจาก K PLUS ไปยัง Make by KBank (statement)'),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[KPLUS], 43253.07 - 1000);
    assert.strictEqual(balances[MAKE], 757.83);
  });

  it('a transfer before the sender anchor only affects the receiver', () => {
    const { balances } = computeAccountBalances([
      tx('2026-10-28', 'TRANSFER', 3000, MAKE, 'โอนจาก Make by KBank ไปยัง K PLUS (statement)'),
      tx('2026-10-28', 'TRANSFER', 50, MAKE, 'โอนเงิน: MAKE by KBank โอนไป KTB X9289 สมชาย'),
    ], [MAKE_ANCHOR]);
    assert.strictEqual(balances[MAKE], 757.83);
    assert.strictEqual(balances[KPLUS], 43253.07 + 3000);
    assert.strictEqual(balances[PAOTANG], Math.round((195.44 + 50) * 100) / 100);
  });

  it('a transfer after both anchors moves money between them', () => {
    const { balances } = computeAccountBalances([
      tx('2026-11-01', 'TRANSFER', 100, KPLUS, 'โอนไป X2996'),
      tx('2026-10-31', 'TRANSFER', 200, KPLUS, 'โอนไป X2996'),
    ], [MAKE_ANCHOR, { account: KPLUS, periodEnd: '2026-10-31', closingBalance: 41234.5 }]);
    // 31-10 is covered by the K PLUS statement but not by the Make one
    assert.strictEqual(balances[KPLUS], 41234.5 - 100);
    assert.strictEqual(balances[MAKE], 757.83 + 100 + 200);
  });

  it('ignores anchors older than the baseline and keeps the newest of two', () => {
    const { balances, asOf } = computeAccountBalances([], [
      { account: KPLUS, periodEnd: '2026-08-31', closingBalance: 1 },
      { account: MAKE, periodEnd: '2026-09-30', closingBalance: 2 },
      { account: MAKE, periodEnd: '2026-10-29', closingBalance: 757.83 },
    ]);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });
    assert.strictEqual(balances[KPLUS], 43253.07);
    assert.strictEqual(balances[MAKE], 757.83);
  });
});

describe('computeAccountBalances with LINE rows and a statement anchor', () => {
  it('counts LINE rows after the cutoff on top of the closing balance, not those before', () => {
    const kplusAnchor = { account: KPLUS, periodEnd: '2026-11-08', closingBalance: 10000 };
    const { balances } = computeAccountBalances([
      tx('2026-11-08', 'EXPENSE', 50, KPLUS),
      tx('2026-11-09', 'EXPENSE', 150, KPLUS),
      tx('2026-11-09', 'TRANSFER', 100, KPLUS, 'โอนจาก K PLUS ไปยัง Make by KBank (LINE รอตรวจสอบสลิป)'),
    ], [kplusAnchor]);
    assert.strictEqual(balances[KPLUS], 10000 - 150 - 100);
    assert.strictEqual(balances[MAKE], Math.round((BASELINE_BALANCES[MAKE] + 100) * 100) / 100);
  });
});

describe('Make statement import + anchor, end to end', () => {
  it('Make shows the bank balance (757.83 - the 32 slip of 2026-10-30 = 725.83)', () => {
    const text = readFileSync(new URL('../statement/fixtures/make-statement-2026-10.txt', import.meta.url), 'utf8');
    const parsed = parseStatement(text, 'STM_SA2996_01OCT26_29OCT26.pdf');

    // Before: Make rows from slips only (some deposits missing), plus the slip after the statement
    const sheet = [
      { date: '2026-10-08', amount: 1000, type: 'TRANSFER' as const, account: KPLUS, note: 'โอนระหว่างบัญชี', driveFileId: 'd1' },
      { date: '2026-10-27', amount: 1596, type: 'EXPENSE' as const, account: MAKE, note: 'บาร์บีคิว', driveFileId: 'd2' },
      { date: '2026-10-30', amount: 32, type: 'EXPENSE' as const, account: MAKE, note: 'slip after the statement', driveFileId: 'd3' },
    ];
    const plan = planStatementImport(sheet, [{ account: parsed.account!, transactions: parsed.transactions }]);
    const rows: BalanceTransaction[] = [...sheet, ...plan.toAppend];

    const { balances, asOf } = computeAccountBalances(rows, [{
      account: parsed.account!,
      periodEnd: parsed.header.periodEnd!,
      closingBalance: parsed.header.closingBalance!,
    }]);
    assert.strictEqual(balances[MAKE], 725.83);
    assert.deepStrictEqual(asOf, { [MAKE]: '2026-10-29' });

    // K PLUS (no anchor) loses exactly the five transfers to Make and gains the 3,000 back
    const kplusDelta = Math.round((balances[KPLUS] - 43253.07) * 100) / 100;
    assert.strictEqual(kplusDelta, -(1000 + 750 + 1000 + 200 + 1000) + 3000);
    // เป๋าตัง gains the three Make -> เป๋าตัง transfers
    assert.strictEqual(Math.round((balances[PAOTANG] - 195.44) * 100) / 100, 300 + 170 + 50);
  });
});

describe('computeAccountBalancesWithCards (KBank Live card balances and gaps)', () => {
  it('with no cards keeps the ledger balances and returns null gaps (never 0)', () => {
    const rows = [
      tx('2026-11-01', 'EXPENSE', 253.07, KPLUS, '', '10:00:00'),
      tx('2026-11-02', 'INCOME', 100, MAKE, '', '12:00:00'),
      tx('2026-11-03', 'INCOME', 50, 'เงินสด', '', '15:00:00'),
    ];
    const res = computeAccountBalancesWithCards(rows, [MAKE_ANCHOR], []);
    assert.strictEqual(res.balances[KPLUS], 43000);
    assert.strictEqual(res.balances[MAKE], 857.83);
    assert.strictEqual(res.balances[PAOTANG], 195.44);
    assert.strictEqual(res.balances['เงินสด'], 50);
    assert.deepStrictEqual(res.gaps, { [KPLUS]: null, [MAKE]: null });
    assert.deepStrictEqual(res.cardTimes, { [KPLUS]: null, [MAKE]: null });
    assert.strictEqual(res.totalCash, Math.round((43000 + 857.83 + 195.44 + 50) * 100) / 100);
  });

  it('picks the newest of several cards in the same minute using seq', () => {
    const anchor = { account: KPLUS, periodEnd: '2026-11-08', closingBalance: 10000 };
    const rows = [
      tx('2026-11-09', 'EXPENSE', 100, KPLUS, '', '21:28:00'),
      tx('2026-11-09', 'EXPENSE', 50, KPLUS, '', '21:28:00'),
    ];
    const cards = [
      card(KPLUS, '2026-11-09', '21:28:00', 9900, 4),
      card(KPLUS, '2026-11-09', '21:28:00', 9850, 6),
      card(KPLUS, '2026-11-09', '21:28:00', 9880, 5),
      // earlier minute with higher seq still loses to later minute
      card(KPLUS, '2026-11-09', '21:27:00', 9999, 99),
    ];
    const res = computeAccountBalancesWithCards(rows, [anchor], cards);
    assert.strictEqual(res.balances[KPLUS], 9850);
    assert.strictEqual(res.ledgerBalances[KPLUS], 9850);
    assert.strictEqual(res.gaps[KPLUS], 0);
    assert.strictEqual(res.cardTimes[KPLUS], '2026-11-09 21:28');
    assert.strictEqual(res.gaps[MAKE], null);
  });

  it('counts rows in the card minute and excludes rows after the card', () => {
    const anchor = { account: KPLUS, periodEnd: '2026-11-08', closingBalance: 10000 };
    const rows = [
      tx('2026-11-09', 'EXPENSE', 150, KPLUS, 'before card', '21:20:00'),
      tx('2026-11-09', 'EXPENSE', 50, KPLUS, 'same minute with seconds', '21:28:45'),
      tx('2026-11-09', 'EXPENSE', 300, KPLUS, 'one minute after card', '21:29:00'),
      tx('2026-11-10', 'EXPENSE', 400, KPLUS, 'next day', '08:00:00'),
    ];
    const res = computeAccountBalancesWithCards(rows, [anchor], [
      card(KPLUS, '2026-11-09', '21:28:00', 9800, 1),
    ]);
    assert.strictEqual(res.balances[KPLUS], 9800);
    assert.strictEqual(res.ledgerBalances[KPLUS], 9800);
    assert.strictEqual(res.gaps[KPLUS], 0);
  });

  it('cuts off each side of a transfer by its own account card when only one side has a card', () => {
    const kplusAnchor = { account: KPLUS, periodEnd: '2026-11-08', closingBalance: 10000 };
    const rows = [
      tx('2026-11-09', 'EXPENSE', 200, KPLUS, '', '10:00:00'),
      // Transfer happens at 15:00, after the K PLUS card at 14:00; Make has no card
      tx('2026-11-09', 'TRANSFER', 500, KPLUS, 'โอนไป X2996', '15:00:00'),
    ];
    const resSenderCardOnly = computeAccountBalancesWithCards(
      rows,
      [kplusAnchor, MAKE_ANCHOR],
      [card(KPLUS, '2026-11-09', '14:00:00', 9800, 1)],
    );
    // K PLUS ledger stops at 14:00 (before the 15:00 transfer)
    assert.strictEqual(resSenderCardOnly.ledgerBalances[KPLUS], 9800);
    assert.strictEqual(resSenderCardOnly.balances[KPLUS], 9800);
    assert.strictEqual(resSenderCardOnly.gaps[KPLUS], 0);
    // Make has no card: keeps old balance including the 15:00 transfer and gap is null
    assert.strictEqual(resSenderCardOnly.balances[MAKE], Math.round((757.83 + 500) * 100) / 100);
    assert.strictEqual(resSenderCardOnly.gaps[MAKE], null);

    // Opposite: Make has a card at 14:00 (before the 15:00 transfer), K PLUS has no card
    const resReceiverCardOnly = computeAccountBalancesWithCards(
      rows,
      [kplusAnchor, MAKE_ANCHOR],
      [card(MAKE, '2026-11-09', '14:00:00', 757.83, 1)],
    );
    assert.strictEqual(resReceiverCardOnly.balances[KPLUS], 10000 - 200 - 500);
    assert.strictEqual(resReceiverCardOnly.gaps[KPLUS], null);
    assert.strictEqual(resReceiverCardOnly.ledgerBalances[MAKE], 757.83);
    assert.strictEqual(resReceiverCardOnly.balances[MAKE], 757.83);
    assert.strictEqual(resReceiverCardOnly.gaps[MAKE], 0);
  });

  it('computes positive gaps (missing expense) and negative gaps (doubled expense), and totalCash from cards', () => {
    const kplusAnchor = { account: KPLUS, periodEnd: '2026-11-08', closingBalance: 10000 };
    const rows = [
      // K PLUS is missing a 150.25 expense -> ledger has 10000, bank card has 9849.75 -> gap +150.25
      // Make has a doubled 40.10 expense -> ledger has 757.83 - 80.20 = 677.63, bank card has 717.73 -> gap -40.10
      tx('2026-11-09', 'EXPENSE', 40.10, MAKE, 'expense', '11:00:00'),
      tx('2026-11-09', 'EXPENSE', 40.10, MAKE, 'doubled expense', '11:00:00'),
      tx('2026-11-09', 'INCOME', 100, 'เงินสด', 'cash in', '09:00:00'),
    ];
    const res = computeAccountBalancesWithCards(
      rows,
      [kplusAnchor, MAKE_ANCHOR],
      [
        card(KPLUS, '2026-11-09', '12:00:00', 9849.75, 1),
        card(MAKE, '2026-11-09', '12:00:00', 717.73, 2),
      ],
    );
    assert.strictEqual(res.balances[KPLUS], 9849.75);
    assert.strictEqual(res.ledgerBalances[KPLUS], 10000);
    assert.strictEqual(res.gaps[KPLUS], 150.25);

    assert.strictEqual(res.balances[MAKE], 717.73);
    assert.strictEqual(res.ledgerBalances[MAKE], 677.63);
    assert.strictEqual(res.gaps[MAKE], -40.1);

    assert.strictEqual(res.balances[PAOTANG], 195.44);
    assert.strictEqual(res.balances['เงินสด'], 100);
    assert.strictEqual(res.totalCash, Math.round((9849.75 + 717.73 + 195.44 + 100) * 100) / 100);
  });

  it('ignores a statement anchor newer than the card when computing the ledger balance at the card cutoff', () => {
    const rows = [
      tx('2026-10-10', 'EXPENSE', 253.07, KPLUS, 'before card', '10:00:00'),
      tx('2026-10-20', 'EXPENSE', 1000, KPLUS, 'after card, inside October statement', '12:00:00'),
    ];
    // Statement period ends 2026-10-31 (closing balance 42000 at end of Oct 31), which is newer than the Oct 15 card
    const newerAnchor = { account: KPLUS, periodEnd: '2026-10-31', closingBalance: 42000 };
    const res = computeAccountBalancesWithCards(
      rows,
      [newerAnchor],
      [card(KPLUS, '2026-10-15', '14:00:00', 43000, 1)],
    );
    // Ledger at 2026-10-15 14:00 starts from the 2026-09-04 baseline (43253.07) minus 253.07 = 43000
    assert.strictEqual(res.ledgerBalances[KPLUS], 43000);
    assert.strictEqual(res.balances[KPLUS], 43000);
    assert.strictEqual(res.gaps[KPLUS], 0);
    assert.strictEqual(res.asOf[KPLUS], undefined);

    // If an older September statement anchor also exists, it is used instead of the newer October one
    const olderAnchor = { account: KPLUS, periodEnd: '2026-09-30', closingBalance: 43253.07 };
    const resWithOlder = computeAccountBalancesWithCards(
      rows,
      [olderAnchor, newerAnchor],
      [card(KPLUS, '2026-10-15', '14:00:00', 43000, 1)],
    );
    assert.strictEqual(resWithOlder.ledgerBalances[KPLUS], 43000);
    assert.strictEqual(resWithOlder.gaps[KPLUS], 0);
    assert.strictEqual(resWithOlder.asOf[KPLUS], '2026-09-30');
  });
});
