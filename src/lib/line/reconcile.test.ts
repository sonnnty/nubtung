import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { ingestCard, reconcileSlips } from './ingest.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { parseCard } from './kbank-card.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { rowFingerprint, PENDING_CATEGORY } from './reconcile.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { resolveTransferDestination } from '../balance/transfer-destination.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { planStatementImport } from '../statement/import-plan.ts';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { computeAccountBalances } from '../balance/account-balances.ts';
import type { LedgerStore } from './ingest.ts';
import type { KBankCard } from './kbank-card.ts';
import type { DeleteOp, LineAlert, LineRow, RowFingerprint, SlipFact, SlipResult, StoredCard, UpdateOp } from './reconcile.ts';

const KPLUS = 'K PLUS';
const MAKE = 'Make by KBank';

before(() => {
  process.env.KPLUS_ACCOUNT_NO = '1183966651';
  process.env.MAKE_ACCOUNT_NO = '1183962996';
});
after(() => {
  delete process.env.KPLUS_ACCOUNT_NO;
  delete process.env.MAKE_ACCOUNT_NO;
});

/** Sheet + Postgres in memory; `failAt` simulates a crash just before that step */
class FakeStore implements LedgerStore {
  rows: LineRow[] = [];
  cards: StoredCard[] = [];
  fingerprints = new Map<string, RowFingerprint>();
  slips = new Map<string, SlipFact>();
  applied = new Map<string, SlipResult>();
  alerts = new Map<string, LineAlert>();
  resolved = new Set<string>();
  failAt: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  private step(name: string) {
    if (this.failAt === name) {
      this.failAt = null;
      throw new Error(`crash at ${name}`);
    }
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
  async readRows() { return this.rows.map(r => ({ ...r })); }
  async findCard(key: string) { return this.cards.find(c => c.key === key) ?? null; }
  async listCards() { return this.cards.map(c => ({ ...c })); }
  async saveCard(card: KBankCard, txId: string) {
    this.step('saveCard');
    if (!this.cards.some(c => c.key === card.key)) {
      const { messageId: _unused, ...stored } = card;
      void _unused;
      this.cards.push({ ...stored, txId, seq: ++this.seq });
    }
  }
  async relinkCards(links: Array<{ key: string; txId: string }>) {
    for (const link of links) this.cards.find(c => c.key === link.key)!.txId = link.txId;
  }
  async readFingerprints() { return new Map(this.fingerprints); }
  async prepareFingerprints(rows: Array<{ id: string; fingerprint: string }>) {
    this.step('prepare');
    for (const r of rows) {
      const prev = this.fingerprints.get(r.id);
      this.fingerprints.set(r.id, { fingerprint: prev?.fingerprint ?? null, pendingFingerprint: r.fingerprint });
    }
  }
  async commitFingerprints(rows: Array<{ id: string; fingerprint: string }>) {
    for (const r of rows) this.fingerprints.set(r.id, { fingerprint: r.fingerprint, pendingFingerprint: null });
  }
  async appendRows(rows: LineRow[]) {
    this.step('append');
    this.rows.push(...rows.map(r => ({ ...r })));
  }
  async updateRows(ops: UpdateOp[]) {
    this.step('update');
    for (const op of ops) {
      const i = this.rows.findIndex(r => r.id === op.row.id);
      if (i < 0) throw new Error(`row gone: ${op.row.id}`);
      if (rowFingerprint(this.rows[i]) !== op.expected) throw new Error(`row changed: ${op.row.id}`);
    }
    for (const op of ops) this.rows[this.rows.findIndex(r => r.id === op.row.id)] = { ...op.row };
  }
  async deleteRows(ops: DeleteOp[]) {
    for (const op of ops) this.rows = this.rows.filter(r => r.id !== op.id);
  }
  async unappliedSlips() { return [...this.slips.values()].filter(s => !this.applied.has(s.driveFileId)); }
  async markSlipsApplied(results: SlipResult[]) {
    this.step('markApplied');
    for (const r of results) this.applied.set(r.driveFileId, r);
  }
  async recordAlerts(alerts: LineAlert[]) { for (const a of alerts) this.alerts.set(a.id, a); }
  async resolveAlerts(ids: string[]) { for (const id of ids) this.resolved.add(id); }

  addSlip(slip: SlipFact) { this.slips.set(slip.driveFileId, slip); }
  ledger() { return this.rows.map(r => `${r.account}|${r.type}|${r.amount}|${r.category}|${r.source}`).sort(); }
  /** An edit made by a person, in the app or directly in the sheet */
  handEdit(id: string, patch: Partial<LineRow>) {
    const row = this.rows.find(r => r.id === id)!;
    Object.assign(row, patch);
  }
}

const out = (amount: number, balance: string, date = '9 พ.ย. 69 21:28 น.', account = 'xxx-x-x6665-x') => ({
  title: 'รายการโอน/ถอน', date, account, amount: `-${amount.toFixed(2)} บาท`, balance: `${balance} บาท`,
});
const inc = (amount: number, balance: string, date = '9 พ.ย. 69 21:28  น.', account = 'xxx-x-x6299-x') => ({
  title: 'รายการเงินเข้า', date, account, amount: `${amount.toFixed(2)}  บาท`, balance: `${balance}  บาท`,
});

function slip(id: string, over: Partial<SlipFact> = {}): SlipFact {
  return {
    driveFileId: `drive_${id}`,
    account: KPLUS,
    date: '2026-11-09',
    time: '21:29:10',
    amount: 150,
    type: 'EXPENSE',
    category: 'อาหารและเครื่องดื่ม',
    note: 'ร้านข้าวมันไก่',
    slipUrl: `https://drive.google.com/file/d/drive_${id}/view`,
    ...over,
  };
}

const selfTransferSlip = (id: string, over: Partial<SlipFact> = {}) =>
  slip(id, { type: 'TRANSFER', category: 'โอนระหว่างบัญชี', note: 'โอนระหว่างบัญชี', ...over });

function single(store: FakeStore): LineRow {
  assert.equal(store.rows.length, 1);
  return store.rows[0];
}

let store: FakeStore;
beforeEach(() => {
  store = new FakeStore();
});

describe('cards', () => {
  it('writes a pending row right away', async () => {
    const res = await ingestCard(out(150, '13,698.33'), store);
    assert.equal(res.status, 'added');
    const row = single(store);
    assert.equal(row.category, PENDING_CATEGORY);
    assert.equal(row.source, 'LINE');
    assert.equal(row.type, 'EXPENSE');
    assert.equal(row.time, '21:28:00');
  });

  it('adds nothing on a re-post', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    const again = await ingestCard({ ...out(150, '13,698.33'), date: '9  พ.ย.  69  21:28 น.' }, store);
    assert.equal(again.status, 'duplicate');
    assert.equal(store.rows.length, 1);
  });

  it('does not create two rows for concurrent posts of one card', async () => {
    const [a, b] = await Promise.all([ingestCard(out(150, '13,698.33'), store), ingestCard(out(150, '13,698.33'), store)]);
    assert.deepEqual([a.status, b.status].sort(), ['added', 'duplicate']);
    assert.equal(store.rows.length, 1);
  });

  it('keeps two equal purchases in one minute apart by balance', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    await ingestCard(out(150, '13,548.33'), store);
    assert.equal(store.rows.length, 2);
  });

  it('sends unknown titles and accounts to review, not the ledger', async () => {
    const title = await ingestCard({ ...out(150, '13,698.33'), title: 'ชำระเงิน QR' }, store);
    const account = await ingestCard(out(150, '13,698.33', undefined, 'xxx-x-x1234-x'), store);
    assert.equal(title.status, 'needs_review');
    assert.equal(account.status, 'needs_review');
    assert.equal(store.rows.length, 0);
    assert.equal(store.alerts.size, 2);
  });

  it('retries cleanly when the card was not recorded after its row was written', async () => {
    store.failAt = 'saveCard';
    await assert.rejects(ingestCard(out(150, '13,698.33'), store));
    assert.equal(store.rows.length, 1);
    const res = await ingestCard(out(150, '13,698.33'), store);
    assert.equal(res.status, 'recovered');
    assert.equal(store.rows.length, 1);
    assert.equal(store.cards.length, 1);
  });
});

describe('balance continuity', () => {
  it('warns about a gap but still writes the row', async () => {
    await ingestCard(out(100, '1,000.00'), store);
    const res = await ingestCard(out(50, '800.00', '9 พ.ย. 69 21:40 น.'), store);
    assert.equal(res.status, 'added');
    assert.equal(res.warnings.length, 1);
    assert.equal(store.rows.length, 2);
    assert.equal([...store.alerts.values()][0].kind, 'MISSING_CARD');
  });

  it('is quiet when the balances chain, in or out of the same minute', async () => {
    await ingestCard(out(100, '1,000.00'), store);
    await ingestCard(inc(200, '1,200.00', '9 พ.ย. 69 21:29 น.', 'xxx-x-x6665-x'), store);
    await ingestCard(out(50, '1,150.00', '9 พ.ย. 69 21:29 น.'), store);
    assert.equal(store.alerts.size, 0);
  });

  it('a late card resolves the gap it fills', async () => {
    await ingestCard(out(100, '1,000.00'), store);
    const gap = await ingestCard(out(50, '850.00', '9 พ.ย. 69 21:40 น.'), store);
    assert.equal(gap.warnings.length, 1);
    const fill = await ingestCard(out(100, '900.00', '9 พ.ย. 69 21:35 น.'), store);
    assert.equal(fill.warnings.length, 0);
    assert.equal(store.resolved.size, 1);
  });
});

describe('card first, then slip', () => {
  it('updates the row in place and appends nothing', async () => {
    const { txId } = await ingestCard(out(150, '13,698.33'), store) as { txId: string };
    store.addSlip(slip('a'));
    const counts = await reconcileSlips(store);
    assert.equal(counts.merged, 1);
    const row = single(store);
    assert.equal(row.id, txId);
    assert.equal(row.category, 'อาหารและเครื่องดื่ม');
    assert.equal(row.note, 'ร้านข้าวมันไก่');
    assert.equal(row.driveFileId, 'drive_a');
    assert.equal(row.source, 'LINE+SLIP');
  });

  it('corrects the row to TRANSFER when the slip shows a self-transfer', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    store.addSlip(selfTransferSlip('a', { note: 'โอนระหว่างบัญชี' }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.corrected, 1);
    const row = single(store);
    assert.equal(row.type, 'TRANSFER');
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
  });

  it('a matched row still adds no row when the in card comes later', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    store.addSlip(selfTransferSlip('a'));
    await reconcileSlips(store);
    const res = await ingestCard(inc(150, '1,143.83'), store);
    assert.equal(res.status, 'attached');
    assert.equal(single(store).source, 'LINE+SLIP');
  });
});

describe('slip first, then card', () => {
  it('leaves the slip row and adds nothing for the card', async () => {
    store.addSlip(slip('a'));
    await reconcileSlips(store);
    assert.equal(single(store).source, 'AUTO_SYNC');
    const res = await ingestCard(out(150, '13,698.33'), store);
    assert.equal(res.status, 'attached');
    assert.equal(single(store).source, 'AUTO_SYNC');
    assert.equal(single(store).category, 'อาหารและเครื่องดื่ม');
  });

  it('a self-transfer slip takes both cards without a new row', async () => {
    store.addSlip(selfTransferSlip('a'));
    await reconcileSlips(store);
    assert.equal((await ingestCard(out(150, '13,698.33'), store)).status, 'attached');
    assert.equal((await ingestCard(inc(150, '1,143.83'), store)).status, 'attached');
    assert.equal(store.rows.length, 1);
  });

  it('a second equal card takes no row-slot already filled', async () => {
    store.addSlip(slip('a'));
    await reconcileSlips(store);
    await ingestCard(out(150, '13,698.33'), store);
    const second = await ingestCard(out(150, '13,548.33', '9 พ.ย. 69 21:30 น.'), store);
    assert.equal(second.status, 'added');
    assert.equal(store.rows.length, 2);
  });
});

describe('re-running sync', () => {
  it('changes nothing on a second run', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    store.addSlip(slip('a'));
    await reconcileSlips(store);
    const before = store.ledger();
    const counts = await reconcileSlips(store);
    assert.deepEqual(Object.values(counts).reduce((a, b) => a + b, 0), 0);
    assert.deepEqual(store.ledger(), before);
  });

  it('finishes a run that crashed after writing, without doubling', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    store.addSlip(slip('a'));
    store.failAt = 'markApplied';
    await assert.rejects(reconcileSlips(store));
    const counts = await reconcileSlips(store);
    assert.equal(counts.already, 1);
    assert.equal(single(store).source, 'LINE+SLIP');
  });

  it('retries a slip that failed before the sheet was written', async () => {
    await ingestCard(out(150, '13,698.33'), store);
    store.addSlip(slip('a'));
    store.failAt = 'update';
    await assert.rejects(reconcileSlips(store));
    assert.equal(single(store).source, 'LINE');
    const counts = await reconcileSlips(store);
    assert.equal(counts.merged, 1);
    assert.equal(single(store).source, 'LINE+SLIP');
  });
});

describe('two equal amounts on one day', () => {
  it('each slip goes to its own row, nearest time first', async () => {
    await ingestCard(out(150, '1,000.00', '9 พ.ย. 69 10:00 น.'), store);
    await ingestCard(out(150, '850.00', '9 พ.ย. 69 18:00 น.'), store);
    store.addSlip(slip('late', { time: '18:01:00', note: 'เย็น' }));
    store.addSlip(slip('early', { time: '10:01:00', note: 'เช้า' }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.merged, 2);
    const byTime = [...store.rows].sort((a, b) => a.time.localeCompare(b.time));
    assert.deepEqual(byTime.map(r => r.note), ['เช้า', 'เย็น']);
    assert.equal(store.rows.length, 2);
  });

  it('within the window, assigns globally so neither slip steals the other row', async () => {
    await ingestCard(out(150, '1,000.00', '9 พ.ย. 69 10:00 น.'), store);
    await ingestCard(out(150, '850.00', '9 พ.ย. 69 10:04 น.'), store);
    store.addSlip(slip('a', { time: '10:03:00', note: 'A' }));
    store.addSlip(slip('b', { time: '10:00:20', note: 'B' }));
    await reconcileSlips(store);
    const byTime = [...store.rows].sort((x, y) => x.time.localeCompare(y.time));
    assert.deepEqual(byTime.map(r => r.note), ['B', 'A']);
  });

  it('a slip with no card in its window is appended as today', async () => {
    await ingestCard(out(150, '1,000.00', '9 พ.ย. 69 10:00 น.'), store);
    store.addSlip(slip('far', { time: '10:06:00' }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.appended, 1);
    assert.equal(store.rows.length, 2);
  });
});

describe('internal transfers from two cards', () => {
  it('out card first: the in card updates the row, stored on the sender', async () => {
    const first = await ingestCard(out(500, '9,500.00'), store);
    assert.equal(first.status, 'added');
    const second = await ingestCard(inc(500, '1,500.00', '9 พ.ย. 69 21:29 น.'), store);
    assert.equal(second.status, 'paired');
    const row = single(store);
    assert.equal(row.type, 'TRANSFER');
    assert.equal(row.account, KPLUS);
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
    assert.equal(row.source, 'LINE');
  });

  it('in card first: same result on the sending account', async () => {
    const first = await ingestCard(inc(500, '1,500.00'), store);
    assert.equal(first.status, 'added');
    assert.equal(single(store).account, MAKE);
    const second = await ingestCard(out(500, '9,500.00', '9 พ.ย. 69 21:29 น.'), store);
    assert.equal(second.status, 'paired');
    const row = single(store);
    assert.equal(row.type, 'TRANSFER');
    assert.equal(row.account, KPLUS);
    assert.equal(row.date, '2026-11-09');
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
  });

  it('the pair is retried safely after a crash between write and record', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    store.failAt = 'saveCard';
    await assert.rejects(ingestCard(inc(500, '1,500.00'), store));
    const res = await ingestCard(inc(500, '1,500.00'), store);
    assert.equal(res.status, 'paired');
    assert.equal(store.rows.length, 1);
    assert.equal(store.cards.length, 2);
  });

  it('does not pair outside the window or on the same account', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    await ingestCard(inc(500, '1,500.00', '9 พ.ย. 69 21:32 น.'), store);
    assert.equal(store.rows.length, 2);
    const sameAccount = new FakeStore();
    await ingestCard(out(500, '9,500.00'), sameAccount);
    await ingestCard(inc(500, '10,000.00', '9 พ.ย. 69 21:29 น.', 'xxx-x-x6665-x'), sameAccount);
    assert.equal(sameAccount.rows.length, 2);
  });

  it('a self-transfer slip confirms the pair', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    await ingestCard(inc(500, '1,500.00'), store);
    store.addSlip(selfTransferSlip('t', { amount: 500 }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.confirmed, 1);
    const row = single(store);
    assert.equal(row.source, 'LINE+SLIP');
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
  });
});

describe('a transfer undone by a slip', () => {
  const paysSomeoneElse = (over: Partial<SlipFact> = {}) =>
    slip('v', { amount: 500, category: 'ช้อปปิ้ง', note: 'ร้านค้าออนไลน์', ...over });

  for (const order of ['out first', 'in first']) {
    it(`restores one row per card (${order})`, async () => {
      if (order === 'out first') {
        await ingestCard(out(500, '9,500.00'), store);
        await ingestCard(inc(500, '1,500.00'), store);
      } else {
        await ingestCard(inc(500, '1,500.00'), store);
        await ingestCard(out(500, '9,500.00'), store);
      }
      assert.equal(single(store).type, 'TRANSFER');

      store.addSlip(paysSomeoneElse());
      const counts = await reconcileSlips(store);
      assert.equal(counts.undone, 1);
      assert.equal(store.rows.length, 2);
      const sender = store.rows.find(r => r.account === KPLUS)!;
      const receiver = store.rows.find(r => r.account === MAKE)!;
      assert.deepEqual([sender.type, sender.category, sender.source, sender.driveFileId], ['EXPENSE', 'ช้อปปิ้ง', 'LINE+SLIP', 'drive_v']);
      assert.deepEqual([receiver.type, receiver.category, receiver.source], ['INCOME', PENDING_CATEGORY, 'LINE']);
      assert.notEqual(sender.id, receiver.id);

      const ledger = store.ledger();
      const again = await reconcileSlips(store);
      assert.equal(Object.values(again).reduce((a, b) => a + b, 0), 0);
      assert.deepEqual(store.ledger(), ledger);
    });
  }

  for (const failAt of ['append', 'update']) {
    it(`converges after a crash at ${failAt} during the undo`, async () => {
      await ingestCard(inc(500, '1,500.00'), store);
      await ingestCard(out(500, '9,500.00'), store);
      store.addSlip(paysSomeoneElse());
      store.failAt = failAt;
      await assert.rejects(reconcileSlips(store));
      await reconcileSlips(store);
      assert.equal(store.rows.length, 2);
      assert.equal(store.rows.filter(r => r.account === KPLUS)[0].source, 'LINE+SLIP');
      assert.equal(store.rows.filter(r => r.account === MAKE)[0].type, 'INCOME');
      const receiverKey = store.cards.find(c => c.direction === 'IN')!;
      assert.equal(receiverKey.txId, store.rows.find(r => r.account === MAKE)!.id);
    });
  }

  it('after an undo the in card of a later slip stays pending for the owner', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    await ingestCard(inc(500, '1,500.00'), store);
    store.addSlip(paysSomeoneElse());
    await reconcileSlips(store);
    const receiver = store.rows.find(r => r.account === MAKE)!;
    assert.equal(receiver.category, PENDING_CATEGORY);
    assert.equal(receiver.type, 'INCOME');
  });

  it('an income slip for the in card undoes the pair', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    await ingestCard(inc(500, '1,500.00'), store);
    store.addSlip(slip('i', { account: MAKE, amount: 500, type: 'INCOME', category: 'เงินเดือน/รายรับ', note: 'รับโอนจาก ลูกค้า' }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.undone, 1);
    const receiver = store.rows.find(r => r.account === MAKE)!;
    assert.deepEqual([receiver.type, receiver.driveFileId, receiver.source], ['INCOME', 'drive_i', 'LINE+SLIP']);
    const sender = store.rows.find(r => r.account === KPLUS)!;
    assert.deepEqual([sender.type, sender.source], ['EXPENSE', 'LINE']);
  });
});

describe('a self-transfer slip against a lone in card', () => {
  it('turns the in card row into the transfer and the out card then adds nothing', async () => {
    await ingestCard(inc(500, '1,500.00'), store);
    store.addSlip(selfTransferSlip('t', { amount: 500 }));
    const counts = await reconcileSlips(store);
    assert.equal(counts.adopted, 1);
    const row = single(store);
    assert.deepEqual([row.account, row.type, row.source], [KPLUS, 'TRANSFER', 'LINE+SLIP']);
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
    assert.equal((await ingestCard(out(500, '9,500.00'), store)).status, 'attached');
    assert.equal(store.rows.length, 1);
  });

  it('removes the lone deposit when the out row takes the transfer slip', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    await ingestCard(inc(500, '1,500.00', '9 พ.ย. 69 21:33 น.'), store); // too far apart to pair
    assert.equal(store.rows.length, 2);
    store.addSlip(selfTransferSlip('t', { amount: 500, time: '21:29:00' }));
    await reconcileSlips(store);
    const row = single(store);
    assert.deepEqual([row.account, row.type], [KPLUS, 'TRANSFER']);
  });

  it('corrects to TRANSFER using the receiver account number when the note names nobody', async () => {
    await ingestCard(out(500, '9,500.00'), store);
    store.addSlip(selfTransferSlip('t', { amount: 500, note: 'ค่าเช่า', receiverAccount: 'xxx-x-x6299-x' }));
    await reconcileSlips(store);
    const row = single(store);
    assert.equal(row.type, 'TRANSFER');
    assert.equal(resolveTransferDestination(row.note, row.account), MAKE);
  });
});

describe('rows edited by hand', () => {
  it('a slip never overwrites an edited row, and is consumed instead of appended', async () => {
    const { txId } = await ingestCard(out(150, '13,698.33'), store) as { txId: string };
    store.handEdit(txId, { category: 'ช้อปปิ้ง', note: 'แก้เอง' });
    store.addSlip(slip('a'));
    const counts = await reconcileSlips(store);
    assert.equal(counts.protected, 1);
    const row = single(store);
    assert.deepEqual([row.category, row.note, row.source, row.driveFileId], ['ช้อปปิ้ง', 'แก้เอง', 'LINE', undefined]);
  });

  it('never pairs into an edited row', async () => {
    const { txId } = await ingestCard(out(500, '9,500.00'), store) as { txId: string };
    store.handEdit(txId, { category: 'ช้อปปิ้ง' });
    const res = await ingestCard(inc(500, '1,500.00'), store);
    assert.equal(res.status, 'added');
    assert.equal(store.rows.length, 2);
  });

  it('an owner-marked transfer takes the in card instead of a new deposit', async () => {
    const { txId } = await ingestCard(out(500, '9,500.00'), store) as { txId: string };
    store.handEdit(txId, { type: 'TRANSFER', category: 'โอนระหว่างบัญชี', note: 'โอนไป make' });
    const res = await ingestCard(inc(500, '1,500.00'), store);
    assert.equal(res.status, 'attached');
    assert.equal(store.rows.length, 1);
  });

  it('leaves MANUAL rows alone and warns about a likely duplicate', async () => {
    store.rows.push({ id: 'm1', date: '2026-11-09', time: '21:28:00', type: 'EXPENSE', amount: 150, category: 'อื่นๆ', account: KPLUS, note: 'จดเอง', source: 'MANUAL' });
    const res = await ingestCard(out(150, '13,698.33'), store);
    assert.equal(res.status, 'added');
    assert.equal(res.warnings.length, 1);
    const manual = store.rows.find(r => r.id === 'm1')!;
    assert.deepEqual([manual.note, manual.source], ['จดเอง', 'MANUAL']);
  });

  it('a change made after the plan was read blocks the write', async () => {
    const { txId } = await ingestCard(out(150, '13,698.33'), store) as { txId: string };
    store.addSlip(slip('a'));
    const realRead = store.readRows.bind(store);
    let edited = false;
    store.readRows = async () => {
      const rows = await realRead();
      if (!edited) {
        edited = true;
        store.handEdit(txId, { note: 'แก้ระหว่างซิงค์' });
      }
      return rows;
    };
    await assert.rejects(reconcileSlips(store), /row changed/);
    assert.equal(single(store).note, 'แก้ระหว่างซิงค์');
  });
});

describe('a statement arriving after LINE rows', () => {
  const statementRow = (date: string, time: string, amount: number, type: 'EXPENSE' | 'TRANSFER', direction: 'OUT' | 'IN', details: string, counterparty: string | null) => ({
    date, time, typeDesc: 'โอนเงิน', type, amount, category: 'อื่นๆ', channel: KPLUS, details, direction, counterparty,
  });

  it('matches every LINE row, doubles nothing, and counts later rows on top of the closing balance', async () => {
    await ingestCard(out(150, '9,850.00', '8 พ.ย. 69 09:00 น.'), store); // inside the statement period
    await ingestCard(out(500, '9,350.00', '8 พ.ย. 69 21:28 น.'), store);
    await ingestCard(inc(500, '1,500.00', '8 พ.ย. 69 21:29 น.'), store); // paired: inside
    await ingestCard(out(40, '9,310.00', '9 พ.ย. 69 08:00 น.'), store); // after the statement's cutoff

    const plan = planStatementImport(store.rows, [
      {
        account: KPLUS,
        transactions: [
          statementRow('2026-11-08', '09:00:00', 150, 'EXPENSE', 'OUT', 'ชำระเงิน', null),
          statementRow('2026-11-08', '21:28:00', 500, 'TRANSFER', 'OUT', 'โอนไป X2996', MAKE),
        ],
      },
      { account: MAKE, transactions: [statementRow('2026-11-08', '21:29:00', 500, 'TRANSFER', 'IN', 'รับโอนจาก X6651', KPLUS)] },
    ]);
    assert.equal(plan.toAppend.length, 0);
    assert.equal(plan.matched, 3);

    const { balances } = computeAccountBalances(store.rows, [{ account: KPLUS, periodEnd: '2026-11-08', closingBalance: 9350 }]);
    assert.equal(balances[KPLUS], 9310);
  });
});
