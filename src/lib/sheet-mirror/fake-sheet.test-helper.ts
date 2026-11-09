// An in-memory Google Sheet for tests, including the ways the real API misbehaves.
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { query } from '../db/index.ts';
import type { Cell, SheetGateway, ValueRender } from './worker.ts';

function colIndex(letter: string): number {
  return letter.charCodeAt(0) - 'A'.charCodeAt(0);
}

function parseRange(range: string) {
  const match = range.match(/^'(.+)'!([A-Z])(\d*):([A-Z])(\d*)$/);
  if (!match) throw new Error(`fake sheet: bad range ${range}`);
  const [, tab, c1, r1, c2, r2] = match;
  return {
    tab,
    firstCol: colIndex(c1),
    lastCol: colIndex(c2),
    firstRow: r1 ? parseInt(r1, 10) : 1,
    lastRow: r2 ? parseInt(r2, 10) : Infinity,
  };
}

export class FakeSheet implements SheetGateway {
  tabs = new Map<string, Cell[][]>();
  calls: string[] = [];
  /** Thrown by the next write calls, in order */
  failures: Error[] = [];
  /** A write that lands on Google but whose response is lost: applied, then this is thrown */
  lostResponses: Error[] = [];
  /** Runs on the next read; simulates someone changing the Sheet between two reads */
  onRead: (() => void) | null = null;

  seed(tab: string, rows: Cell[][]) {
    this.tabs.set(tab, rows.map(r => [...r]));
  }

  private rows(tab: string): Cell[][] {
    let rows = this.tabs.get(tab);
    if (!rows) {
      rows = [];
      this.tabs.set(tab, rows);
    }
    return rows;
  }

  async ensureStructure() {
    this.calls.push('ensureStructure');
  }

  private displayed(cell: Cell | undefined, render: ValueRender): Cell {
    if (cell === undefined || cell === null) return '';
    if (typeof cell === 'number') {
      return render === 'UNFORMATTED_VALUE' ? cell : cell.toLocaleString('en-US', { minimumFractionDigits: 2 });
    }
    if (render !== 'FORMULA' && String(cell).startsWith('=HYPERLINK')) {
      return String(cell).match(/,\s*"([^"]*)"\)$/)?.[1] ?? '';
    }
    return cell;
  }

  async getValues(range: string, render: ValueRender = 'FORMATTED_VALUE'): Promise<Cell[][]> {
    this.calls.push(`get ${range} ${render}`);
    if (this.onRead) {
      const fn = this.onRead;
      this.onRead = null;
      fn();
    }
    const { tab, firstCol, lastCol, firstRow, lastRow } = parseRange(range);
    const out: Cell[][] = [];
    for (let i = firstRow - 1; i < Math.min(this.rows(tab).length, lastRow); i++) {
      const cells = (this.rows(tab)[i] ?? []).slice(firstCol, lastCol + 1).map(c => this.displayed(c, render));
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      out.push(cells);
    }
    while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  private beginWrite(name: string): Error | null {
    this.calls.push(name);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return this.lostResponses.shift() ?? null;
  }

  async updateValues(data: Array<{ range: string; values: Cell[][] }>) {
    const lost = this.beginWrite(`update ${data.map(d => d.range).join(',')}`);
    for (const { range, values } of data) {
      const { tab, firstCol, firstRow } = parseRange(range);
      const rows = this.rows(tab);
      values.forEach((row, r) => {
        const index = firstRow - 1 + r;
        while (rows.length <= index) rows.push([]);
        const target = rows[index];
        row.forEach((cell, c) => { target[firstCol + c] = cell; });
      });
    }
    if (lost) throw lost;
  }

  async appendValues(range: string, values: Cell[][]) {
    const lost = this.beginWrite(`append ${values.length}`);
    const { tab } = parseRange(range);
    const rows = this.rows(tab);
    while (rows.length > 0 && rows[rows.length - 1].every(c => c === '' || c === undefined)) rows.pop();
    rows.push(...values.map(r => [...r]));
    if (lost) throw lost;
  }

  async clearValues(range: string) {
    const lost = this.beginWrite(`clear ${range}`);
    const { tab, firstCol, lastCol, firstRow, lastRow } = parseRange(range);
    const rows = this.rows(tab);
    for (let i = firstRow - 1; i < rows.length && i < lastRow; i++) {
      for (let c = firstCol; c <= lastCol; c++) rows[i][c] = '';
    }
    if (lost) throw lost;
  }

  async deleteRows(tab: string, rowNumbers: number[]) {
    const lost = this.beginWrite(`delete ${rowNumbers.join(',')}`);
    const rows = this.rows(tab);
    for (const row of [...rowNumbers].sort((a, b) => b - a)) rows.splice(row - 1, 1);
    if (lost) throw lost;
  }
}

/** Empties every table; the schema stays, so memoized init calls remain valid */
export async function resetDatabase(): Promise<void> {
  await query(`
    TRUNCATE transactions, tax_profiles, sheet_outbox, line_cards, slip_facts, line_alerts RESTART IDENTITY;
    DELETE FROM sheet_mirror_state;
    INSERT INTO sheet_mirror_state (id) VALUES (1);
  `);
}

export function quotaError(retryAfter?: string): Error {
  return Object.assign(new Error('Quota exceeded'), {
    code: 429,
    response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
  });
}
