import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { normalizeDateString, normalizeTimeString } from './date.ts';

describe('normalizeDateString', () => {
  const cases: Array<[string, string]> = [
    ['2026-09-04', '2026-09-04'],
    ['2026-9-4', '2026-09-04'],
    ['2569-01-05', '2026-01-05'],
    ['2026-09-04T10:30:00', '2026-09-04'],
    ['2026/9/4', '2026-09-04'],
    ['4/9/2026', '2026-09-04'],
    ['5/1/2569', '2026-01-05'],
    ['4-9-2026', '2026-09-04'],
    ['4/9/26', '2026-09-04'],
    ['4/9/69', '2026-09-04'],
    ['9 พ.ย. 69', '2026-11-09'],
    ['9 พ.ย. 2569', '2026-11-09'],
    ['9 พฤศจิกายน 2569', '2026-11-09'],
    ['9 Nov 2026', '2026-11-09'],
    ['Nov 9, 2026', '2026-11-09'],
    ['45234', '2023-11-04'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => assert.equal(normalizeDateString(input), expected));
  }
  it('returns what it cannot read, so nothing is lost', () => assert.equal(normalizeDateString('เมื่อวาน'), 'เมื่อวาน'));
  it('keeps a blank date blank', () => assert.equal(normalizeDateString(''), ''));
});

describe('normalizeTimeString', () => {
  const cases: Array<[string, string]> = [
    ['09:30:00', '09:30:00'],
    ['9:30', '09:30:00'],
    ['9:30:00 PM', '21:30:00'],
    ['12:05 AM', '00:05:00'],
    ['21:28 น.', '21:28:00'],
    ['13.30', '13:30:00'],
    ['13.30 น.', '13:30:00'],
    ['0.5', '12:00:00'],
    ['', '00:00:00'],
    ['-', '00:00:00'],
    ['ไม่ระบุ', '00:00:00'],
  ];
  for (const [input, expected] of cases) {
    it(`${input || '(blank)'} -> ${expected}`, () => assert.equal(normalizeTimeString(input), expected));
  }
});
