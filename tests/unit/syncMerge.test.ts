import { describe, expect, it } from 'vitest';
import { emptyState, mergeState, validateState, type StateDoc } from '../../src/core/syncMerge.ts';

const K1 = 'a'.repeat(32);
const K2 = 'b'.repeat(32);
const doc = (deviceId: string, at: number, page: number, finished = false): StateDoc => ({
  ...emptyState(deviceId, new Date(at).toISOString()),
  progress: [
    { contentKey: K1, page, pageCount: 10, percent: 0, finished, updatedAt: at, deviceId },
  ],
  bookmarks: [{ id: 'bm' + deviceId, contentKey: K2, page: 1, createdAt: at, updatedAt: at }],
});

describe('mergeState', () => {
  const a = doc('A', 100, 3);
  const b = doc('B', 200, 7);
  it('commutative', () => expect(mergeState(a, b)).toEqual(mergeState(b, a)));
  it('idempotent', () => expect(mergeState(mergeState(a, b), b)).toEqual(mergeState(a, b)));
  it('newest progress wins, bookmarks union', () => {
    const m = mergeState(a, b);
    expect(m.progress[0]!.page).toBe(7);
    expect(m.bookmarks).toHaveLength(2);
  });
  it('finished is sticky unless the book was restarted', () => {
    expect(mergeState(doc('A', 100, 9, true), doc('B', 200, 6)).progress[0]!.finished).toBe(true);
    expect(mergeState(doc('A', 100, 9, true), doc('B', 200, 1)).progress[0]!.finished).toBe(false);
  });
  it('validateState rejects foreign files and sanitises', () => {
    expect(() => validateState({ format: 'x' })).toThrow();
    const v = validateState({
      ...a,
      progress: [{ ...a.progress[0], page: 9999 }, { contentKey: 'bad' }],
    });
    expect(v.progress).toHaveLength(1);
    expect(v.progress[0]!.page).toBe(9);
  });
});
