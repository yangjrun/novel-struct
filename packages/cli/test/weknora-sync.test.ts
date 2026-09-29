import { expect, it } from 'vitest';
import { parseWeKnoraIndex, syncWeKnoraRange } from '../src/commands/search.js';

it('requires a complete, ordered pair of chapter indexes for a bounded WeKnora sync', () => {
  expect(syncWeKnoraRange({})).toBeUndefined();
  expect(syncWeKnoraRange({ from: 1, to: 3 })).toEqual({ from: 1, to: 3 });
  expect(() => syncWeKnoraRange({ from: 1 })).toThrow('--from 和 --to');
  expect(() => syncWeKnoraRange({ to: 3 })).toThrow('--from 和 --to');
  expect(() => syncWeKnoraRange({ from: 3, to: 1 })).toThrow('--from 和 --to');
});

it('rejects partial, negative and unsafe indexes rather than silently broadening the sync', () => {
  expect(parseWeKnoraIndex('0')).toBe(0);
  expect(parseWeKnoraIndex('3')).toBe(3);
  for (const value of ['-1', '1.5', '2oops', '9007199254740992', '']) {
    expect(() => parseWeKnoraIndex(value)).toThrow('章节 index');
  }
});
