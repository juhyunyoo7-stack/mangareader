import type {
  Direction,
  LayoutMode,
  OverrideKind,
  PageInfo,
  PageOverride,
  Spread,
} from './types.ts';

export interface SpreadOptions {
  coverOffset: boolean;
  pairShift: 0 | 1;
  overrides: PageOverride[];
  layout: LayoutMode;
}

/** Landscape pages (double-page scans) are "wide". */
export function isWide(w: number, h: number, threshold = 1): boolean {
  return h > 0 && w / h >= threshold && w > h;
}

/**
 * Pure spread layout (DESIGN 4.1). `layout` 'auto' pairs like 'double'; the caller resolves
 * auto against the viewport before deciding whether to pass 'single'.
 */
export function layoutSpreads(pages: PageInfo[], opts: SpreadOptions): Spread[] {
  const ov = new Map<number, OverrideKind>();
  for (const o of opts.overrides) ov.set(o.index, o.kind);
  const visible = pages.filter((p) => ov.get(p.index) !== 'hidden');
  if (opts.layout === 'single' || opts.layout === 'webtoon') {
    return visible.map((p) => ({ pages: [p.index] }));
  }
  const out: Spread[] = [];
  let pending: number | null = null;
  const flush = () => {
    if (pending !== null) out.push({ pages: [pending] });
    pending = null;
  };
  const shiftBreakAt = opts.coverOffset ? 2 : 1;
  for (const p of visible) {
    const kind = ov.get(p.index);
    if (p.index === 0 && opts.coverOffset) {
      flush();
      out.push({ pages: [p.index] });
      continue;
    }
    if (p.wide || kind === 'single') {
      flush();
      out.push({ pages: [p.index] });
      continue;
    }
    if (kind === 'spreadStart' || (opts.pairShift === 1 && p.index === shiftBreakAt)) flush();
    if (pending === null) pending = p.index;
    else {
      out.push({ pages: [pending, p.index] });
      pending = null;
    }
  }
  flush();
  return out;
}

/** Index of the spread that contains `page` (nearest following visible page if hidden). */
export function pageToSpread(spreads: Spread[], page: number): number {
  if (spreads.length === 0) return 0;
  for (let i = 0; i < spreads.length; i++) {
    if (spreads[i]!.pages.includes(page)) return i;
  }
  for (let i = 0; i < spreads.length; i++) {
    if (Math.min(...spreads[i]!.pages) > page) return i;
  }
  return spreads.length - 1;
}

/** Lowest page index inside the spread. */
export function spreadToPage(spreads: Spread[], spread: number): number {
  const s = spreads[Math.max(0, Math.min(spreads.length - 1, spread))];
  return s ? Math.min(...s.pages) : 0;
}

/** Left-to-right visual order of a spread's pages. */
export function visualOrder(spread: Spread, direction: Direction): number[] {
  return direction === 'rtl' ? [...spread.pages].reverse() : [...spread.pages];
}

/** Auto layout resolution: double when viewport is clearly landscape. */
export function resolveLayout(layout: LayoutMode, viewW: number, viewH: number): LayoutMode {
  if (layout !== 'auto') return layout;
  return viewH > 0 && viewW / viewH > 1.2 ? 'double' : 'single';
}
