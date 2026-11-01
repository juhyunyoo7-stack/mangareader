import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_PIXELS,
  MAX_DIMENSION,
  bitmapBytes,
  clampDecodeSize,
  fitsCanvas,
  intersects,
  planStrips,
  planTiles,
  tilesForRegion,
} from '../../src/core/tiling.ts';
import { budgetFor, detectDeviceClass } from '../../src/core/memoryBudget.ts';
import { PageCache, type Closable } from '../../src/engine/PageCache.ts';

describe('clampDecodeSize', () => {
  it('never upscales beyond native pixels', () => {
    expect(clampDecodeSize({ w: 800, h: 1200 }, { w: 4000, h: 6000 })).toMatchObject({
      w: 800,
      h: 1200,
      scale: 1,
    });
  });
  it('downscales to fit the wanted box preserving aspect', () => {
    const r = clampDecodeSize({ w: 2000, h: 3000 }, { w: 500, h: 500 });
    expect(r.h).toBe(500);
    expect(r.w).toBe(333);
  });
  it('caps area at 16 MP (5000x5000 source at native request)', () => {
    const r = clampDecodeSize({ w: 5000, h: 5000 }, { w: 5000, h: 5000 });
    expect(r.w * r.h).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(r.w).toBeLessThanOrEqual(4000);
  });
  it('caps the longest side at 8192', () => {
    const r = clampDecodeSize({ w: 800, h: 30000 }, { w: 800, h: 30000 });
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(MAX_DIMENSION);
    expect(r.h).toBeLessThanOrEqual(8192);
  });
  it('handles degenerate wants', () => {
    const r = clampDecodeSize({ w: 100, h: 100 }, { w: 0, h: 0 });
    expect(r.w).toBeGreaterThanOrEqual(1);
    const nan = clampDecodeSize({ w: 100, h: 100 }, { w: NaN, h: NaN });
    expect(nan.w).toBe(100);
  });
  it('property: result always fits the canvas limits', () => {
    for (const [w, h] of [
      [1, 1],
      [100, 20000],
      [12000, 18000],
      [9000, 9000],
      [16000, 16000],
      [3, 90000],
    ] as const) {
      for (const want of [
        [50, 50],
        [4000, 4000],
        [20000, 20000],
      ] as const) {
        const r = clampDecodeSize({ w, h }, { w: want[0], h: want[1] });
        expect(fitsCanvas(r.w, r.h), `${w}x${h} -> ${want}`).toBe(true);
      }
    }
  });
});

describe('tiles', () => {
  it('plans a covering grid with every tile <= 2048 and no overlap', () => {
    const tiles = planTiles(5000, 5000);
    expect(tiles).toHaveLength(9);
    const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
    expect(area).toBe(5000 * 5000);
    for (const t of tiles) {
      expect(t.w).toBeLessThanOrEqual(2048);
      expect(t.h).toBeLessThanOrEqual(2048);
      expect(t.w * t.h).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    }
  });
  it('single tile when small, exact edges', () => {
    expect(planTiles(100, 50)).toEqual([{ x: 0, y: 0, w: 100, h: 50 }]);
    expect(planTiles(2048, 2048)).toHaveLength(1);
    expect(planTiles(2049, 1)).toHaveLength(2);
  });
  it('region selection returns only intersecting tiles', () => {
    const t = tilesForRegion(5000, 5000, { x: 100, y: 100, w: 200, h: 200 });
    expect(t).toEqual([{ x: 0, y: 0, w: 2048, h: 2048 }]);
    const across = tilesForRegion(5000, 5000, { x: 2000, y: 2000, w: 100, h: 100 });
    expect(across).toHaveLength(4);
  });
  it('intersects is exclusive at edges', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
  });
  it('strips of a 30000 px page', () => {
    const s = planStrips(30000);
    expect(s).toHaveLength(15);
    expect(s[14]).toEqual({ y: 28672, h: 1328 });
    expect(s.reduce((a, x) => a + x.h, 0)).toBe(30000);
  });
  it('bitmapBytes', () => expect(bitmapBytes(10, 10)).toBe(400));
});

describe('memory budgets', () => {
  const base = { platform: 'Win32', maxTouchPoints: 0, screenShortSide: 800 };
  it('device classes', () => {
    expect(detectDeviceClass({ ...base, userAgent: 'Mozilla iPhone OS 18' })).toBe('iphone');
    expect(detectDeviceClass({ ...base, userAgent: 'Mozilla iPad' })).toBe('ipad');
    expect(
      detectDeviceClass({
        ...base,
        platform: 'MacIntel',
        maxTouchPoints: 5,
        userAgent: 'Mozilla Macintosh',
      }),
    ).toBe('ipad');
    expect(detectDeviceClass({ ...base, userAgent: 'Linux Android 14', deviceMemory: 8 })).toBe(
      'android-high',
    );
    expect(detectDeviceClass({ ...base, userAgent: 'Linux Android 14', deviceMemory: 4 })).toBe(
      'android-low',
    );
    expect(detectDeviceClass({ ...base, userAgent: 'Windows NT' })).toBe('desktop');
  });
  it('budgets follow DESIGN 7.2', () => {
    const MB = 1024 * 1024;
    expect(budgetFor('iphone').cacheBytes).toBe(200 * MB);
    expect(budgetFor('ipad').cacheBytes).toBe(350 * MB);
    expect(budgetFor('desktop').cacheBytes).toBe(800 * MB);
    expect(budgetFor('android-low').cacheBytes).toBe(250 * MB);
    expect(budgetFor('iphone').wholeArchiveLimit).toBe(300 * MB);
    expect(budgetFor('ipad').wholeArchiveLimit).toBe(600 * MB);
  });
});

class FakeBitmap implements Closable {
  closed = false;
  constructor(
    public width: number,
    public height: number,
  ) {}
  close() {
    this.closed = true;
  }
}

describe('PageCache', () => {
  it('evicts least-recently-used and closes bitmaps', () => {
    const c = new PageCache<FakeBitmap>(4000); // 10x10 bitmaps are 400 bytes
    const bms = Array.from({ length: 12 }, () => new FakeBitmap(10, 10));
    bms.forEach((b, i) => c.set(`k${i}`, b));
    expect(c.stats().bytes).toBeLessThanOrEqual(4000);
    expect(c.stats().entries).toBe(10);
    expect(bms[0]!.closed).toBe(true);
    expect(bms[1]!.closed).toBe(true);
    expect(bms[11]!.closed).toBe(false);
    expect(c.stats().evictions).toBe(2);
  });
  it('get refreshes recency', () => {
    const c = new PageCache<FakeBitmap>(1200);
    const a = new FakeBitmap(10, 10);
    c.set('a', a);
    c.set('b', new FakeBitmap(10, 10));
    c.set('c', new FakeBitmap(10, 10));
    c.get('a');
    c.set('d', new FakeBitmap(10, 10));
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });
  it('pinned entries survive even over budget', () => {
    const c = new PageCache<FakeBitmap>(500);
    c.pin(['a', 'b']);
    const a = new FakeBitmap(10, 10);
    c.set('a', a);
    c.set('b', new FakeBitmap(10, 10));
    expect(c.has('a') && c.has('b')).toBe(true);
    expect(a.closed).toBe(false);
    c.pin([]);
    c.set('c', new FakeBitmap(10, 10));
    expect(c.stats().bytes).toBeLessThanOrEqual(500);
  });
  it('external bytes count against the budget', () => {
    const c = new PageCache<FakeBitmap>(1000);
    c.set('a', new FakeBitmap(10, 10));
    c.set('b', new FakeBitmap(10, 10));
    c.setExternal(600);
    expect(c.stats().total).toBeLessThanOrEqual(1000);
    expect(c.stats().entries).toBe(1);
  });
  it('replacing a key closes the old bitmap and keeps byte count right', () => {
    const c = new PageCache<FakeBitmap>(10_000);
    const a = new FakeBitmap(10, 10);
    c.set('a', a);
    c.set('a', new FakeBitmap(20, 20));
    expect(a.closed).toBe(true);
    expect(c.stats().bytes).toBe(1600);
  });
  it('dropUnpinned and clear close everything', () => {
    const c = new PageCache<FakeBitmap>(10_000);
    const bs = [new FakeBitmap(1, 1), new FakeBitmap(1, 1), new FakeBitmap(1, 1)];
    bs.forEach((b, i) => c.set(`k${i}`, b));
    c.pin(['k1']);
    c.dropUnpinned();
    expect(bs.map((b) => b.closed)).toEqual([true, false, true]);
    c.clear();
    expect(bs.every((b) => b.closed)).toBe(true);
    expect(c.stats()).toMatchObject({ bytes: 0, entries: 0 });
  });
  it('stress: bytes never exceed budget when nothing is pinned', () => {
    const c = new PageCache<FakeBitmap>(100_000);
    for (let i = 0; i < 500; i++) {
      c.set(`k${i}`, new FakeBitmap(10 + (i % 30), 10 + (i % 17)));
      expect(c.stats().total).toBeLessThanOrEqual(100_000);
    }
    expect(c.stats().peakTotal).toBeLessThanOrEqual(100_000);
  });
});
