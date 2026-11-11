import { describe, it, before } from 'node:test';
import assert from 'node:assert';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { computeAccountBalancesWithCards } from './account-balances.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import {
  BALANCE_ADJUSTMENT_CATEGORY,
  describeBalanceAdjustment,
  isBalanceAdjustment,
  planBalanceAdjustment,
  withoutBalanceAdjustments,
} from './balance-adjustment.ts';
import type { BalanceCard, BalanceTransaction } from './account-balances.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';
const KPLUS_ANCHOR = { account: KPLUS, periodEnd: '2026-11-01', closingBalance: 10000 };

const tx = (
  date: string,
  type: BalanceTransaction['type'],
  amount: number,
  account: string,
  time = '10:00:00',
): BalanceTransaction => ({ date, time, type, amount, account, note: '' });

const card = (account: string, date: string, time: string, balance: number, seq = 1): BalanceCard =>
  ({ account, date, time, balance, seq });

before(() => {
  process.env.OWN_ACCOUNT_NAMES = 'สมชาย';
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
  delete process.env.PAOTANG_ACCOUNT_NO;
});

describe('planBalanceAdjustment', () => {
  const newest = { date: '2026-11-10', time: '14:32:00', balance: 8530.6 };

  it('adds INCOME for a negative gap (ledger below the bank) with the absolute amount', () => {
    const row = planBalanceAdjustment(KPLUS, -1469.4, newest)!;
    assert.strictEqual(row.type, 'INCOME');
    assert.strictEqual(row.amount, 1469.4);
    assert.strictEqual(row.account, KPLUS);
    assert.strictEqual(row.category, BALANCE_ADJUSTMENT_CATEGORY);
    assert.strictEqual(row.source, 'MANUAL');
    assert.strictEqual(row.date, '2026-11-10');
    assert.strictEqual(row.time, '14:32:00');
    assert.strictEqual(
      row.note,
      'รายการปรับจำนวนเงิน: ให้ยอดตรงกับธนาคาร (KBank Live 2026-11-10 14:32 ยอด 8,530.60)',
    );
  });

  it('adds EXPENSE for a positive gap (ledger above the bank)', () => {
    const row = planBalanceAdjustment(MAKE, 855, newest)!;
    assert.strictEqual(row.type, 'EXPENSE');
    assert.strictEqual(row.amount, 855);
    assert.strictEqual(row.account, MAKE);
  });

  it('adds nothing for a zero, missing or non-finite gap', () => {
    assert.strictEqual(planBalanceAdjustment(KPLUS, 0, newest), null);
    assert.strictEqual(planBalanceAdjustment(KPLUS, -0, newest), null);
    assert.strictEqual(planBalanceAdjustment(KPLUS, 0.004, newest), null);
    assert.strictEqual(planBalanceAdjustment(KPLUS, null, newest), null);
    assert.strictEqual(planBalanceAdjustment(KPLUS, undefined, newest), null);
    assert.strictEqual(planBalanceAdjustment(KPLUS, NaN, newest), null);
  });

  it('describes what the confirm dialog will add', () => {
    assert.strictEqual(describeBalanceAdjustment(KPLUS, -1469.4), 'เพิ่มรายการรายรับ ฿1,469.40 ใน K PLUS เพื่อให้ตรงกับยอดธนาคาร');
    assert.strictEqual(describeBalanceAdjustment(MAKE, 855), 'เพิ่มรายการรายจ่าย ฿855.00 ใน Make by KBank เพื่อให้ตรงกับยอดธนาคาร');
  });
});

describe('an adjustment row closes the gap', () => {
  const rows = [tx('2026-11-05', 'EXPENSE', 100, KPLUS), tx('2026-11-06', 'EXPENSE', 50.25, MAKE, '09:00:00')];
  const anchors = [KPLUS_ANCHOR, { account: MAKE, periodEnd: '2026-11-01', closingBalance: 2000 }];
  // Ledger: K PLUS 9900, Make 1949.75. Bank says K PLUS 11369.40 (+1469.40), Make 1000.00 (-949.75).
  const cards = [card(KPLUS, '2026-11-10', '14:32:00', 11369.4), card(MAKE, '2026-11-10', '14:32:45', 1000)];

  it('lands on the cutoff minute (even with other seconds) and brings the gap to 0', () => {
    const before = computeAccountBalancesWithCards(rows, anchors, cards);
    assert.strictEqual(before.gaps[KPLUS], -1469.4);
    assert.strictEqual(before.gaps[MAKE], 949.75);

    const adjustments = [
      planBalanceAdjustment(KPLUS, before.gaps[KPLUS], cards[0])!,
      planBalanceAdjustment(MAKE, before.gaps[MAKE], cards[1])!,
    ];
    assert.deepStrictEqual(adjustments.map(a => a.type), ['INCOME', 'EXPENSE']);

    const after = computeAccountBalancesWithCards([...rows, ...adjustments], anchors, cards);
    assert.strictEqual(after.gaps[KPLUS], 0);
    assert.strictEqual(after.gaps[MAKE], 0);
    assert.strictEqual(after.ledgerBalances[KPLUS], 11369.4);
    assert.strictEqual(after.balances[KPLUS], 11369.4);
    assert.strictEqual(after.totalCash, before.totalCash);
  });

  it('a second computation gives no row', () => {
    const first = computeAccountBalancesWithCards(rows, anchors, cards);
    const adjustment = planBalanceAdjustment(KPLUS, first.gaps[KPLUS], cards[0])!;
    const second = computeAccountBalancesWithCards([...rows, adjustment], anchors, cards);
    assert.strictEqual(planBalanceAdjustment(KPLUS, second.gaps[KPLUS], cards[0]), null);
  });

  it('stays closed when a newer card follows from the adjusted balance', () => {
    const first = computeAccountBalancesWithCards(rows, anchors, cards);
    const adjustment = planBalanceAdjustment(KPLUS, first.gaps[KPLUS], cards[0])!;
    const withNewCard = [...cards, card(KPLUS, '2026-11-11', '08:00:00', 11269.4, 3)];
    const after = computeAccountBalancesWithCards(
      [...rows, adjustment, tx('2026-11-11', 'EXPENSE', 100, KPLUS, '08:00:00')],
      anchors,
      withNewCard,
    );
    assert.strictEqual(after.gaps[KPLUS], 0);
  });

  it('stops affecting the balance once a statement newer than it re-anchors the account', () => {
    const first = computeAccountBalancesWithCards(rows, anchors, cards);
    const adjustment = planBalanceAdjustment(KPLUS, first.gaps[KPLUS], cards[0])!;
    const newerAnchor = { account: KPLUS, periodEnd: '2026-11-10', closingBalance: 11369.4 };
    const res = computeAccountBalancesWithCards([...rows, adjustment], [KPLUS_ANCHOR, newerAnchor]);
    assert.strictEqual(res.balances[KPLUS], 11369.4);
  });
});

describe('isBalanceAdjustment', () => {
  it('is decided by the category alone', () => {
    assert.strictEqual(isBalanceAdjustment({ category: BALANCE_ADJUSTMENT_CATEGORY }), true);
    assert.strictEqual(isBalanceAdjustment({ category: ` ${BALANCE_ADJUSTMENT_CATEGORY} ` }), true);
    assert.strictEqual(isBalanceAdjustment({ category: 'อาหาร' }), false);
    assert.strictEqual(isBalanceAdjustment({ category: '' }), false);
    assert.strictEqual(isBalanceAdjustment({}), false);
  });

  it('withoutBalanceAdjustments keeps every other row', () => {
    const rows = [{ category: 'อาหาร' }, { category: BALANCE_ADJUSTMENT_CATEGORY }, { category: 'เงินเดือน' }];
    assert.deepStrictEqual(withoutBalanceAdjustments(rows), [{ category: 'อาหาร' }, { category: 'เงินเดือน' }]);
  });
});
