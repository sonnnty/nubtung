import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseStatement, parseStatementText, checkStatementTotals, periodEndFromStatementFileName } from './statement-text.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { detectStatementAccount } from './accounts.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const MAKE_TEXT = fixture('make-statement-2026-10.txt');
const KPLUS_TEXT = fixture('kplus-statement-sample.txt');
const MAKE_FILE = 'STM_SA2996_01OCT26_29OCT26.pdf';
const KPLUS_FILE = 'STM_SA6651_01OCT26_31OCT26.pdf';

const sum = (xs: Array<{ amount: number }>) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

before(() => {
  process.env.OWN_ACCOUNT_NAMES = 'สมชาย';
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
  delete process.env.PAOTANG_ACCOUNT_NO;
});

describe('statement account detection', () => {
  it('uses the STM_SA<last4> file name', () => {
    assert.strictEqual(detectStatementAccount(MAKE_FILE), 'Make by KBank');
    assert.strictEqual(detectStatementAccount(KPLUS_FILE), 'K PLUS');
  });

  it('falls back to the header account number', () => {
    assert.strictEqual(detectStatementAccount('statement.pdf', MAKE_TEXT), 'Make by KBank');
    assert.strictEqual(detectStatementAccount('statement.pdf', KPLUS_TEXT), 'K PLUS');
  });

  it('returns null for an account the dashboard does not track', () => {
    assert.strictEqual(detectStatementAccount('STM_SA1234_01OCT26_29OCT26.pdf'), null);
    assert.strictEqual(detectStatementAccount('statement.pdf', MAKE_TEXT.replace('118-3-96299-6', '111-1-11111-1')), null);
    assert.strictEqual(detectStatementAccount('statement.pdf', 'no header at all'), null);
  });

  it('follows MAKE_ACCOUNT_NO / KPLUS_ACCOUNT_NO', () => {
    process.env.MAKE_ACCOUNT_NO = '9999991234';
    try {
      assert.strictEqual(detectStatementAccount('STM_SA1234_01OCT26_29OCT26.pdf'), 'Make by KBank');
      assert.strictEqual(detectStatementAccount(MAKE_FILE), null);
    } finally {
      delete process.env.MAKE_ACCOUNT_NO;
    }
  });

  it('reads the period end from the file name', () => {
    assert.strictEqual(periodEndFromStatementFileName(MAKE_FILE), '2026-10-29');
    assert.strictEqual(periodEndFromStatementFileName('STM_SA6651_01DEC26_05JAN27.pdf'), '2027-01-05');
    assert.strictEqual(periodEndFromStatementFileName('statement.pdf'), null);
  });
});

describe('Make by KBank statement (October 2026 fixture)', () => {
  const parsed = () => parseStatement(MAKE_TEXT, MAKE_FILE);
  const find = (date: string, time: string) => {
    const tx = parsed().transactions.find(t => t.date === date && t.time === time);
    assert.ok(tx, `row ${date} ${time} not found`);
    return tx!;
  };

  it('is detected as Make and every row is on Make', () => {
    const p = parsed();
    assert.strictEqual(p.account, 'Make by KBank');
    assert.ok(p.transactions.every(t => t.channel === 'Make by KBank'));
  });

  it('reads the header: closing balance, period and totals', () => {
    const { header } = parsed();
    assert.strictEqual(header.closingBalance, 757.83);
    assert.strictEqual(header.openingBalance, 4775.83);
    assert.strictEqual(header.periodStart, '2026-10-01');
    assert.strictEqual(header.periodEnd, '2026-10-29');
    assert.strictEqual(header.accountLast4, '2996');
    assert.deepStrictEqual(
      [header.withdrawalCount, header.withdrawalTotal, header.depositCount, header.depositTotal],
      [29, 13417, 9, 9399],
    );
  });

  it('parses all 38 rows and they agree with the header totals', () => {
    const p = parsed();
    const outs = p.transactions.filter(t => t.direction === 'OUT');
    const ins = p.transactions.filter(t => t.direction === 'IN');
    assert.strictEqual(p.transactions.length, 38);
    assert.strictEqual(outs.length, 29);
    assert.strictEqual(sum(outs), 13417);
    assert.strictEqual(ins.length, 9);
    assert.strictEqual(sum(ins), 9399);
    assert.deepStrictEqual(checkStatementTotals(p), []);
    assert.strictEqual(p.transactions[p.transactions.length - 1].balance, 757.83);
  });

  it('classifies a deposit from K PLUS (X6651, own name) as an internal transfer from K PLUS', () => {
    const tx = find('2026-10-08', '20:31:00');
    assert.strictEqual(tx.amount, 1000);
    assert.strictEqual(tx.direction, 'IN');
    assert.strictEqual(tx.type, 'TRANSFER');
    assert.strictEqual(tx.counterparty, 'K PLUS');
    assert.strictEqual(tx.category, 'โอนระหว่างบัญชี');
    const fromKplus = parsed().transactions.filter(t => t.direction === 'IN' && t.counterparty === 'K PLUS');
    assert.deepStrictEqual(fromKplus.map(t => t.amount), [1000, 750, 1000, 200, 1000]);
  });

  it('classifies "โอนไป X6651" (3,000 on 28-10) as a transfer to K PLUS', () => {
    const tx = find('2026-10-28', '18:38:00');
    assert.strictEqual(tx.amount, 3000);
    assert.strictEqual(tx.direction, 'OUT');
    assert.strictEqual(tx.type, 'TRANSFER');
    assert.strictEqual(tx.counterparty, 'K PLUS');
  });

  it('classifies "โอนไป KTB X9289 สมชาย" as a transfer to เป๋าตัง', () => {
    for (const [date, time, amount] of [['2026-10-01', '13:05:00', 300], ['2026-10-05', '19:11:00', 170], ['2026-10-14', '20:33:00', 50]] as const) {
      const tx = find(date, time);
      assert.strictEqual(tx.amount, amount);
      assert.strictEqual(tx.type, 'TRANSFER');
      assert.strictEqual(tx.counterparty, 'เป๋าตัง');
    }
  });

  it('classifies deposits from other people as INCOME', () => {
    for (const [date, time, amount] of [['2026-10-27', '18:46:00', 4000], ['2026-10-27', '20:58:00', 800], ['2026-10-04', '14:54:00', 260], ['2026-10-10', '17:27:00', 389]] as const) {
      const tx = parsed().transactions.find(t => t.date === date && t.time === time && t.direction === 'IN');
      assert.ok(tx);
      assert.strictEqual(tx!.amount, amount);
      assert.strictEqual(tx!.type, 'INCOME');
      assert.strictEqual(tx!.counterparty, null);
    }
  });

  it('classifies payments and transfers to other people as EXPENSE', () => {
    const tx = find('2026-10-01', '11:27:00');
    assert.strictEqual(tx.type, 'EXPENSE');
    assert.strictEqual(tx.counterparty, null);
    const others = parsed().transactions.filter(t => t.direction === 'OUT' && t.type !== 'TRANSFER');
    assert.strictEqual(others.length, 29 - 4);
  });

  it('joins multi-line details and keeps the page footer out of them', () => {
    assert.match(find('2026-10-02', '22:28:00').details, /ATMD2916 โกรกพระ นครสวรรค์ \(\+\+$/);
    assert.match(find('2026-10-05', '12:58:00').details, /MCP-Punthai Siharat Decho Chai Road \(พันธุ์ไทย ถนน$/);
    assert.match(find('2026-10-11', '14:27:00').details, /SCB มณี SHOP \(บานาน่า ครีมชีส BY ธรัช\)$/);
    const last = find('2026-10-28', '19:03:00');
    assert.match(last.details, /กูย่างเนื้อ$/);
    assert.strictEqual(last.category, 'อื่นๆ');
  });
});

describe('K PLUS statement (behaviour unchanged)', () => {
  it('is detected as K PLUS and parsed with the same classification as before', () => {
    const p = parseStatement(KPLUS_TEXT, KPLUS_FILE);
    assert.strictEqual(p.account, 'K PLUS');
    assert.strictEqual(p.header.closingBalance, 41234.5);
    assert.strictEqual(p.header.periodEnd, '2026-10-31');
    assert.deepStrictEqual(checkStatementTotals(p), []);

    const rows = p.transactions.map(t => [t.date, t.time, t.type, t.amount, t.category, t.channel, t.counterparty]);
    assert.deepStrictEqual(rows, [
      ['2026-10-01', '09:00:00', 'TRANSFER', 1000, 'โอนระหว่างบัญชี', 'K PLUS', 'Make by KBank'],
      ['2026-10-01', '12:30:00', 'TRANSFER', 300, 'โอนระหว่างบัญชี', 'K PLUS', 'เป๋าตัง'],
      ['2026-10-03', '22:28:00', 'EXPENSE', 1000, 'การเดินทาง/ค่าน้ำมัน', 'K PLUS', null],
      ['2026-10-05', '11:51:00', 'EXPENSE', 89, 'ของใช้ในบ้าน/ซูเปอร์', 'K PLUS', null],
      // own account the dashboard doesn't track (807513b): INCOME under the transfer category
      ['2026-10-10', '08:15:00', 'INCOME', 5000, 'โอนระหว่างบัญชี', 'K PLUS', null],
      ['2026-10-12', '19:45:00', 'TRANSFER', 3000, 'โอนระหว่างบัญชี', 'K PLUS', 'Make by KBank'],
      ['2026-10-15', '20:58:00', 'EXPENSE', 3085, 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)', 'K PLUS', null],
      ['2026-10-25', '06:00:00', 'INCOME', 25231, 'เงินเดือน/รายรับ', 'K PLUS', null],
      ['2026-10-31', '23:59:00', 'INCOME', 0.23, 'เงินเดือน/รายรับ', 'K PLUS', null],
    ]);
    assert.strictEqual(p.transactions[0].details, 'โอนเงิน: K PLUS                 โอนไป X2996 นาย สมชาย ใจดี++');
    assert.match(p.transactions[2].details, /ATMD2916 โกรกพระ นครสวรรค์ \(\+\+$/);
  });

  it('parseStatementText defaults to K PLUS', () => {
    const txs = parseStatementText(KPLUS_TEXT);
    assert.ok(txs.every(t => t.channel === 'K PLUS'));
  });

  it('an unknown account yields no transactions', () => {
    const p = parseStatement(KPLUS_TEXT.replace('012-3-45665-1', '999-9-99999-9'), 'STM_SA9999_01OCT26_31OCT26.pdf');
    assert.strictEqual(p.account, null);
    assert.deepStrictEqual(p.transactions, []);
  });
});
