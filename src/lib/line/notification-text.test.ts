import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { extractNotificationAmount, parseNotificationText } from './notification-text.ts';

before(() => {
  process.env.KPLUS_ACCOUNT_NO = '1183966651';
  process.env.MAKE_ACCOUNT_NO = '1183962996';
});
after(() => {
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
});

const MAKE_CARD = 'รายการเงินเข้า 9 พ.ย. 69 21:28 น. เข้าบัญชี xxx-x-x6299-x จำนวนเงิน 150.00 บาท ยอดเงินคงเหลือ 1,143.83 บาท';

describe('extractNotificationAmount', () => {
  it('does not take digits of a masked account as the amount', () => {
    assert.equal(extractNotificationAmount('โอนเข้า X2996 จำนวน 1,000.00 บาท'), 1000);
    assert.equal(extractNotificationAmount('บัญชี xxx-x-x6299-x เงินเข้า 500.00'), 500);
  });

  it('takes the amount, not the balance, from a card', () => {
    assert.equal(extractNotificationAmount(MAKE_CARD), 150);
    assert.equal(extractNotificationAmount('ยอดเงินคงเหลือ 13,698.33 บาท จำนวนเงิน -150.00 บาท'), 150);
  });

  it('ignores the date and time in the text', () => {
    assert.equal(extractNotificationAmount('9 พ.ย. 69 21:28 น. ชำระ 49.00'), 49);
    assert.equal(extractNotificationAmount('9 พ.ย. 69 21:28 น.'), 0);
  });

  it('still reads the older message shapes', () => {
    assert.equal(extractNotificationAmount('500.00 บาท'), 500);
    assert.equal(extractNotificationAmount('500'), 500);
    assert.equal(extractNotificationAmount('ไม่มีตัวเลข'), 0);
  });
});

describe('parseNotificationText', () => {
  it('finds Make from the masked account and uses the card time, not receive time', () => {
    const facts = parseNotificationText(MAKE_CARD, new Date('2026-11-10T01:00:00Z'));
    assert.deepEqual(facts, { amount: 150, hasKplus: false, hasMake: true, date: '2026-11-09', time: '21:28:00' });
  });

  it('finds K PLUS from its mask and sees both accounts of a transfer', () => {
    assert.equal(parseNotificationText('จากบัญชี xxx-x-x6665-x จำนวนเงิน -10.00 บาท').hasKplus, true);
    const both = parseNotificationText('จาก xxx-x-x6665-x เข้า xxx-x-x6299-x 10.00 บาท');
    assert.equal(both.hasKplus && both.hasMake, true);
  });

  it('falls back to receive time when the text has no date', () => {
    const facts = parseNotificationText('เงินเข้า 20.00 บาท', new Date('2026-11-10T01:00:00Z'));
    assert.deepEqual([facts.date, facts.time], ['2026-11-10', '08:00:00']);
  });
});
