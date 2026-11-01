import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  canPan,
  clampPan,
  clampZoom,
  fitScale,
  initialView,
  pinchZoom,
  visibleRect,
  zoomAround,
  isZoomed,
} from '../../src/engine/Viewport.ts';
import { classifySwipe, keyCommand, zoneAction } from '../../src/engine/controls.ts';

const view = { w: 1000, h: 800 };

describe('fitScale', () => {
  const content = { w: 800, h: 1200 };
  it('screen = contain', () =>
    expect(fitScale('screen', content, view, 1)).toBeCloseTo(800 / 1200));
  it('width', () => expect(fitScale('width', content, view, 1)).toBeCloseTo(1000 / 800));
  it('height', () => expect(fitScale('height', content, view, 1)).toBeCloseTo(800 / 1200));
  it('original is 1 source px per device px', () => {
    expect(fitScale('original', content, view, 1)).toBe(1);
    expect(fitScale('original', content, view, 2)).toBe(0.5);
  });
  it('degenerate content', () => expect(fitScale('screen', { w: 0, h: 0 }, view, 1)).toBe(1));
});

describe('clampPan', () => {
  const base = { w: 500, h: 800 };
  it('centres content smaller than the viewport', () => {
    const v = clampPan(view, base, { zoom: 1, tx: 300, ty: 99 });
    expect(v.tx).toBe(250);
    expect(v.ty).toBe(0);
  });
  it('bounds oversize content to cover the viewport', () => {
    const v = clampPan(view, base, { zoom: 4, tx: 500, ty: 500 });
    expect(v.tx).toBe(0);
    expect(v.ty).toBe(0);
    const w = clampPan(view, base, { zoom: 4, tx: -99999, ty: -99999 });
    expect(w.tx).toBe(1000 - 2000);
    expect(w.ty).toBe(800 - 3200);
  });
  it('overscroll allows rubber banding up to the slack', () => {
    const v = clampPan(view, base, { zoom: 4, tx: 80, ty: 0 }, 40);
    expect(v.tx).toBe(40);
  });
});

describe('zoomAround', () => {
  const base = { w: 500, h: 800 };
  const start = initialView(view, base, 'ltr');
  it('keeps the content point under the cursor fixed', () => {
    const p = { x: 500, y: 400 };
    const lx = (p.x - start.tx) / start.zoom;
    const ly = (p.y - start.ty) / start.zoom;
    const z = zoomAround(view, base, start, p, 3);
    expect((p.x - z.tx) / z.zoom).toBeCloseTo(lx);
    expect((p.y - z.ty) / z.zoom).toBeCloseTo(ly);
    expect(z.zoom).toBe(3);
  });
  it('clamps zoom to 1..8', () => {
    expect(zoomAround(view, base, start, { x: 0, y: 0 }, 99).zoom).toBe(MAX_ZOOM);
    expect(zoomAround(view, base, start, { x: 0, y: 0 }, 0.1).zoom).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });
  it('zooming at a corner stays inside pan bounds', () => {
    const z = zoomAround(view, base, start, { x: 0, y: 0 }, 8);
    expect(z.tx).toBeLessThanOrEqual(0);
    expect(z.ty).toBeLessThanOrEqual(0);
    expect(z.tx).toBeGreaterThanOrEqual(1000 - 500 * 8);
  });
  it('zoom back to 1 recentres', () => {
    const z = zoomAround(
      view,
      base,
      zoomAround(view, base, start, { x: 100, y: 100 }, 4),
      { x: 100, y: 100 },
      1,
    );
    expect(z).toEqual(start);
  });
});

describe('initialView / visibleRect / canPan', () => {
  it('rtl starts at the right edge of oversize content, ltr at the left', () => {
    const base = { w: 2000, h: 800 };
    expect(initialView(view, base, 'ltr').tx).toBe(0);
    expect(initialView(view, base, 'rtl').tx).toBe(-1000);
  });
  it('visible rect in pre-zoom coordinates', () => {
    const base = { w: 500, h: 800 };
    const v = { zoom: 2, tx: -200, ty: -100 };
    expect(visibleRect(view, v)).toEqual({ x: 100, y: 50, w: 500, h: 400 });
    expect(base).toBeTruthy();
  });
  it('canPan reflects edges', () => {
    const base = { w: 500, h: 800 };
    const atLeft = clampPan(view, base, { zoom: 4, tx: 0, ty: 0 });
    expect(canPan(view, base, atLeft, 'x', 1)).toBe(false); // already at left edge
    expect(canPan(view, base, atLeft, 'x', -1)).toBe(true);
    const unzoomed = initialView(view, base, 'ltr');
    expect(canPan(view, base, unzoomed, 'x', 1)).toBe(false);
    expect(isZoomed(unzoomed)).toBe(false);
  });
  it('pinchZoom scales by finger distance ratio', () => {
    expect(pinchZoom(1, 100, 250)).toBe(2.5);
    expect(pinchZoom(2, 100, 10)).toBe(1);
    expect(pinchZoom(2, 0, 10)).toBe(2);
  });
});

describe('zone hit testing', () => {
  it('standard zones in ltr', () => {
    expect(zoneAction('standard', 'ltr', 100, 400, 1000, 800)).toBe('prev');
    expect(zoneAction('standard', 'ltr', 900, 400, 1000, 800)).toBe('next');
    expect(zoneAction('standard', 'ltr', 500, 400, 1000, 800)).toBe('menu');
    expect(zoneAction('standard', 'ltr', 299, 0, 1000, 800)).toBe('prev');
    expect(zoneAction('standard', 'ltr', 301, 0, 1000, 800)).toBe('menu');
  });
  it('rtl mirrors', () => {
    expect(zoneAction('standard', 'rtl', 100, 400, 1000, 800)).toBe('next');
    expect(zoneAction('standard', 'rtl', 900, 400, 1000, 800)).toBe('prev');
  });
  it('edge preset is narrower and off has only menu', () => {
    expect(zoneAction('edge', 'ltr', 200, 0, 1000, 800)).toBe('menu');
    expect(zoneAction('edge', 'ltr', 100, 0, 1000, 800)).toBe('prev');
    expect(zoneAction('off', 'ltr', 10, 0, 1000, 800)).toBe('menu');
  });
  it('vertical uses top/bottom', () => {
    expect(zoneAction('standard', 'vertical', 500, 100, 1000, 800)).toBe('prev');
    expect(zoneAction('standard', 'vertical', 500, 700, 1000, 800)).toBe('next');
    expect(zoneAction('standard', 'vertical', 100, 400, 1000, 800)).toBe('menu');
  });
  it('zero size', () => expect(zoneAction('standard', 'ltr', 1, 1, 0, 0)).toBe('none'));
});

describe('keyboard commands', () => {
  const k = (key: string, shiftKey = false) => ({ key, shiftKey });
  it('arrows are direction aware', () => {
    expect(keyCommand(k('ArrowRight'), 'ltr', false)).toBe('next');
    expect(keyCommand(k('ArrowRight'), 'rtl', false)).toBe('prev');
    expect(keyCommand(k('ArrowLeft'), 'rtl', false)).toBe('next');
    expect(keyCommand(k('ArrowLeft'), 'ltr', false)).toBe('prev');
    expect(keyCommand(k('ArrowDown'), 'rtl', false)).toBe('next');
  });
  it('arrows pan when zoomed', () => {
    expect(keyCommand(k('ArrowRight'), 'ltr', true)).toBe('panRight');
    expect(keyCommand(k('ArrowUp'), 'ltr', true)).toBe('panUp');
    expect(keyCommand(k('PageDown'), 'ltr', true)).toBe('next');
  });
  it('space / shift+space, home/end and misc', () => {
    expect(keyCommand(k(' '), 'ltr', false)).toBe('next');
    expect(keyCommand(k(' ', true), 'ltr', false)).toBe('prev');
    expect(keyCommand(k('Home'), 'ltr', false)).toBe('first');
    expect(keyCommand(k('End'), 'ltr', false)).toBe('last');
    expect(keyCommand(k('f'), 'ltr', false)).toBe('fullscreen');
    expect(keyCommand(k('d'), 'ltr', false)).toBe('cycleLayout');
    expect(keyCommand(k('r'), 'ltr', false)).toBe('toggleRtl');
    expect(keyCommand(k('o'), 'ltr', false)).toBe('toggleOffset');
    expect(keyCommand(k('['), 'ltr', false)).toBe('shiftDown');
    expect(keyCommand(k(']'), 'ltr', false)).toBe('shiftUp');
    expect(keyCommand(k('+'), 'ltr', false)).toBe('zoomIn');
    expect(keyCommand(k('-'), 'ltr', false)).toBe('zoomOut');
    expect(keyCommand(k('0'), 'ltr', false)).toBe('zoomReset');
    expect(keyCommand(k('Escape'), 'ltr', false)).toBe('escape');
    expect(keyCommand(k('x'), 'ltr', false)).toBeNull();
    expect(keyCommand({ key: 'r', shiftKey: false, ctrlKey: true }, 'ltr', false)).toBeNull();
  });
});

describe('swipe classification', () => {
  it('ltr: swipe left = next, right = prev', () => {
    expect(classifySwipe(-120, 5, 200, 'ltr').action).toBe('next');
    expect(classifySwipe(120, 5, 200, 'ltr').action).toBe('prev');
  });
  it('rtl: swipe right = next', () => {
    expect(classifySwipe(120, 5, 200, 'rtl').action).toBe('next');
    expect(classifySwipe(-120, 5, 200, 'rtl').action).toBe('prev');
  });
  it('vertical: swipe up = next', () => {
    expect(classifySwipe(3, -120, 200, 'vertical').action).toBe('next');
    expect(classifySwipe(3, 120, 200, 'vertical').action).toBe('prev');
  });
  it('rejects short, diagonal or slow drags', () => {
    expect(classifySwipe(-20, 0, 100, 'ltr').action).toBeNull();
    expect(classifySwipe(-100, 90, 100, 'ltr').action).toBeNull();
    expect(classifySwipe(-200, 0, 2000, 'ltr').action).toBeNull();
  });
});
