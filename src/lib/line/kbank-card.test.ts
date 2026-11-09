import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseCard, parseThaiDateTime, parseMoney, cardKey } from './kbank-card.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { maskDigitsOf, accountFromMask, kbankAccountsInText } from '../statement/accounts.ts';

const KPLUS_NO = '1183966651';
const MAKE_NO = '1183962996';

before(() => {
  process.env.KPLUS_ACCOUNT_NO = KPLUS_NO;
  process.env.MAKE_ACCOUNT_NO = MAKE_NO;
});
after(() => {
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
});

const outCard = {
  title: 'รายการโอน/ถอน',
  date: '9 พ.ย. 69 21:28 น.',
  account: 'xxx-x-x6665-x',
  amount: '-150.00 บาท',
  balance: '13,698.33 บาท',
};
const inCard = {
  title: 'รายการเงินเข้า',
  date: '9 พ.ย. 69 21:28  น.',
  account: 'xxx-x-x6299-x',
  amount: '150.00  บาท',
  balance: '1,143.83  บาท',
};

describe('account mask', () => {
  it('derives digits 6-9 of the 10-digit number', () => {
    assert.equal(maskDigitsOf(KPLUS_NO), '6665');
    assert.equal(maskDigitsOf('118-3-96299-6'), '6299');
    assert.equal(maskDigitsOf('6651'), null);
    assert.equal(maskDigitsOf(undefined), null);
  });

  it('maps a mask to its account and rejects anything else', () => {
    assert.equal(accountFromMask('xxx-x-x6665-x'), 'K PLUS');
    assert.equal(accountFromMask('XXX-X-X6299-X'), 'Make by KBank');
    assert.equal(accountFromMask('xxx-x-x1234-x'), null);
    assert.equal(accountFromMask(''), null);
  });

  it('finds accounts in text by mask, X-tail and full number, never by amount digits', () => {
    assert.deepEqual([...kbankAccountsInText('โอนเข้า xxx-x-x6299-x')], ['Make by KBank']);
    assert.deepEqual([...kbankAccountsInText('เข้าบัญชี X2996 จำนวน 50.00')], ['Make by KBank']);
    assert.deepEqual([...kbankAccountsInText('จาก 118-3-96665-1')], ['K PLUS']);
    assert.deepEqual([...kbankAccountsInText(`บัญชี ${KPLUS_NO}`)], ['K PLUS']);
    assert.deepEqual([...kbankAccountsInText('จำนวนเงิน 2996.00 บาท')], []);
    assert.deepEqual([...kbankAccountsInText('จำนวนเงิน 2,996.00 บาท')], []);
  });
});

describe('parseThaiDateTime', () => {
  it('reads the short Buddhist-era year as Bangkok date and minute', () => {
    assert.deepEqual(parseThaiDateTime('9 พ.ย. 69 21:28 น.'), { date: '2026-11-09', time: '21:28:00' });
    assert.deepEqual(parseThaiDateTime('9  พ.ย.   69  21:28   น.'), { date: '2026-11-09', time: '21:28:00' });
  });

  it('rejects impossible dates and unknown months', () => {
    assert.equal(parseThaiDateTime('31 ก.พ. 69 10:00 น.'), null);
    assert.equal(parseThaiDateTime('3 พย 69 10:00 น.'), null);
    assert.equal(parseThaiDateTime('hello'), null);
  });
});

describe('parseMoney', () => {
  it('normalises commas, spaces and units', () => {
    assert.equal(parseMoney('-150.00  บาท'), -150);
    assert.equal(parseMoney('13,698.33 บาท'), 13698.33);
    assert.equal(parseMoney(150.5), 150.5);
    assert.equal(parseMoney('abc'), null);
  });
});

describe('parseCard', () => {
  it('parses an outgoing card', () => {
    const res = parseCard(outCard);
    assert.ok(res.ok);
    assert.equal(res.card.account, 'K PLUS');
    assert.equal(res.card.direction, 'OUT');
    assert.equal(res.card.amount, 150);
    assert.equal(res.card.balance, 13698.33);
    assert.equal(res.card.date, '2026-11-09');
    assert.equal(res.card.time, '21:28:00');
  });

  it('parses an incoming card with double spaces', () => {
    const res = parseCard(inCard);
    assert.ok(res.ok);
    assert.equal(res.card.account, 'Make by KBank');
    assert.equal(res.card.direction, 'IN');
    assert.equal(res.card.balance, 1143.83);
  });

  it('keeps the same key for a respaced card and differs by balance', () => {
    const a = parseCard(inCard);
    const b = parseCard({ ...inCard, date: '9 พ.ย. 69 21:28 น.', balance: '1,143.83 บาท' });
    assert.ok(a.ok && b.ok);
    assert.equal(a.card.key, b.card.key);
    const c = parseCard({ ...inCard, balance: '1,293.83 บาท' });
    assert.ok(c.ok);
    assert.notEqual(a.card.key, c.card.key);
    assert.equal(cardKey({ ...a.card, balance: 1293.83 }), c.card.key);
  });

  it('sends an unknown title, account or a mismatched sign to review', () => {
    const unknownTitle = parseCard({ ...outCard, title: 'ชำระเงิน QR' });
    assert.ok(!unknownTitle.ok);
    assert.match(unknownTitle.reason, /unknown card title/);
    const unknownAccount = parseCard({ ...outCard, account: 'xxx-x-x1234-x' });
    assert.ok(!unknownAccount.ok);
    assert.match(unknownAccount.reason, /unknown account/);
    const badSign = parseCard({ ...outCard, amount: '150.00 บาท' });
    assert.ok(!badSign.ok);
    assert.match(badSign.reason, /sign/);
    assert.ok(!parseCard({ ...outCard, date: 'nope' }).ok);
    assert.ok(!parseCard({ ...outCard, balance: undefined }).ok);
  });

  it('treats an unconfigured account as unknown', () => {
    const saved = process.env.KPLUS_ACCOUNT_NO;
    process.env.KPLUS_ACCOUNT_NO = '6651';
    try {
      const res = parseCard(outCard);
      assert.ok(!res.ok);
      assert.match(res.reason, /unknown account/);
    } finally {
      process.env.KPLUS_ACCOUNT_NO = saved;
    }
  });
});
