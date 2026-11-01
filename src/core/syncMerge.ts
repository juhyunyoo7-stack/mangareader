import type { OverrideKind, ReaderPrefs } from './types.ts';

/** Portable state document (DESIGN section 9). Keyed by contentKey, never by local ids. */
export interface BookRef {
  contentKey: string;
  title: string;
  series: string;
  fileName: string;
  size: number;
}
export interface ProgressRec {
  contentKey: string;
  page: number;
  pageCount: number;
  percent: number;
  webtoonOffset?: number;
  finished: boolean;
  updatedAt: number;
  deviceId: string;
}
export interface BookmarkRec {
  id: string;
  contentKey: string;
  page: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deviceId?: string;
}
export interface SeriesPrefsRec {
  seriesKey: string;
  name: string;
  prefs: ReaderPrefs;
  updatedAt: number;
  deviceId?: string;
}
export interface BookPrefsRec {
  contentKey: string;
  prefs: ReaderPrefs;
  overrides: { index: number; kind: OverrideKind }[];
  updatedAt: number;
  deviceId?: string;
}
export interface CollectionRec {
  id: string;
  name: string;
  bookKeys: string[];
  seriesKeys: string[];
  updatedAt: number;
  deleted?: boolean;
  deviceId?: string;
}

export interface StateDoc {
  format: 'mangareader-state';
  version: 1;
  deviceId: string;
  exportedAt: string;
  books: BookRef[];
  progress: ProgressRec[];
  bookmarks: BookmarkRec[];
  seriesPrefs: SeriesPrefsRec[];
  bookPrefs: BookPrefsRec[];
  collections: CollectionRec[];
}

export function emptyState(deviceId = '', exportedAt = new Date(0).toISOString()): StateDoc {
  return {
    format: 'mangareader-state',
    version: 1,
    deviceId,
    exportedAt,
    books: [],
    progress: [],
    bookmarks: [],
    seriesPrefs: [],
    bookPrefs: [],
    collections: [],
  };
}

interface Stamped {
  updatedAt: number;
  deviceId?: string;
}

/** Deterministic total order: newer wins; on a tie the larger deviceId wins; then canonical JSON. */
function newer<T extends Stamped>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const da = a.deviceId ?? '';
  const db = b.deviceId ?? '';
  if (da !== db) return da > db ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeBy<T extends Stamped>(
  a: T[],
  b: T[],
  key: (t: T) => string,
  pick: (x: T, y: T) => T = newer,
): T[] {
  const m = new Map<string, T>();
  for (const r of [...a, ...b]) {
    const k = key(r);
    const cur = m.get(k);
    m.set(k, cur ? pick(cur, r) : r);
  }
  return [...m.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([, v]) => v);
}

/**
 * Progress: last writer wins, except that a finished flag is sticky unless the winner clearly
 * restarted the book (page in the first half). Depends only on (winner, loser) so merge stays
 * commutative.
 */
function pickProgress(x: ProgressRec, y: ProgressRec): ProgressRec {
  const w = newer(x, y);
  const l = w === x ? y : x;
  if (l.finished && !w.finished && w.page >= w.pageCount / 2) return { ...w, finished: true };
  return w;
}

/** Pure, commutative and idempotent merge of two state documents. */
export function mergeState(a: StateDoc, b: StateDoc): StateDoc {
  const newerDoc =
    a.exportedAt === b.exportedAt
      ? a.deviceId >= b.deviceId
        ? a
        : b
      : a.exportedAt > b.exportedAt
        ? a
        : b;
  return {
    format: 'mangareader-state',
    version: 1,
    deviceId: newerDoc.deviceId,
    exportedAt: newerDoc.exportedAt,
    books: mergeBy(
      a.books.map((r) => ({ ...r, updatedAt: 0 })),
      b.books.map((r) => ({ ...r, updatedAt: 0 })),
      (r) => r.contentKey,
    ).map(({ updatedAt: _u, ...r }) => r),
    progress: mergeBy(a.progress, b.progress, (r) => r.contentKey, pickProgress),
    bookmarks: mergeBy(a.bookmarks, b.bookmarks, (r) => r.id),
    seriesPrefs: mergeBy(a.seriesPrefs, b.seriesPrefs, (r) => r.seriesKey),
    bookPrefs: mergeBy(a.bookPrefs, b.bookPrefs, (r) => r.contentKey),
    collections: mergeBy(a.collections, b.collections, (r) => r.id),
  };
}

// ---- validation of untrusted imports ------------------------------------------------------------
const MAX_RECORDS = 200_000;
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_RECORDS) : []);
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const KEY = /^[0-9a-f]{32}$/;

function sanitizePrefs(v: unknown): ReaderPrefs {
  const out: ReaderPrefs = {};
  if (!isRec(v)) return out;
  if (v.direction === 'ltr' || v.direction === 'rtl' || v.direction === 'vertical')
    out.direction = v.direction;
  if (
    v.layout === 'single' ||
    v.layout === 'double' ||
    v.layout === 'auto' ||
    v.layout === 'webtoon'
  )
    out.layout = v.layout;
  if (v.fit === 'screen' || v.fit === 'width' || v.fit === 'height' || v.fit === 'original')
    out.fit = v.fit;
  if (typeof v.coverOffset === 'boolean') out.coverOffset = v.coverOffset;
  if (v.pairShift === 0 || v.pairShift === 1) out.pairShift = v.pairShift;
  if (typeof v.autoTrim === 'boolean') out.autoTrim = v.autoTrim;
  if (typeof v.guided === 'boolean') out.guided = v.guided;
  if (isRec(v.filters)) {
    const f = v.filters;
    const preset = f.preset === 'night' ? 'invert-soft' : f.preset;
    if (
      preset === 'none' ||
      preset === 'dim' ||
      preset === 'invert-soft' ||
      preset === 'sepia' ||
      preset === 'eink'
    ) {
      const n = (x: unknown) =>
        typeof x === 'number' && Number.isFinite(x) ? Math.min(1.5, Math.max(0.5, x)) : 1;
      out.filters = { preset, brightness: n(f.brightness), contrast: n(f.contrast) };
    }
  }
  return out;
}

/** Throws on a document that is not ours; drops malformed records; clamps every field. */
export function validateState(input: unknown): StateDoc {
  if (!isRec(input) || input.format !== 'mangareader-state')
    throw new Error('Not a MangaReader state file.');
  if (input.version !== 1) throw new Error('Unsupported state file version.');
  const doc = emptyState(
    str(input.deviceId, 64),
    str(input.exportedAt, 40) || new Date(0).toISOString(),
  );
  for (const r of arr(input.books)) {
    if (!isRec(r) || !KEY.test(str(r.contentKey))) continue;
    doc.books.push({
      contentKey: r.contentKey as string,
      title: str(r.title),
      series: str(r.series),
      fileName: str(r.fileName),
      size: num(r.size),
    });
  }
  for (const r of arr(input.progress)) {
    if (!isRec(r) || !KEY.test(str(r.contentKey))) continue;
    const pageCount = num(r.pageCount, 1, 100_000);
    doc.progress.push({
      contentKey: r.contentKey as string,
      page: num(r.page, 0, pageCount - 1),
      pageCount,
      percent: num(r.percent, 0, 100),
      webtoonOffset: typeof r.webtoonOffset === 'number' ? num(r.webtoonOffset, 0, 1) : undefined,
      finished: r.finished === true,
      updatedAt: num(r.updatedAt),
      deviceId: str(r.deviceId, 64),
    });
  }
  for (const r of arr(input.bookmarks)) {
    if (!isRec(r) || !KEY.test(str(r.contentKey)) || !str(r.id, 64)) continue;
    doc.bookmarks.push({
      id: str(r.id, 64),
      contentKey: r.contentKey as string,
      page: num(r.page, 0, 100_000),
      note: typeof r.note === 'string' ? r.note.slice(0, 1000) : undefined,
      createdAt: num(r.createdAt),
      updatedAt: num(r.updatedAt),
      deleted: r.deleted === true ? true : undefined,
      deviceId: str(r.deviceId, 64) || undefined,
    });
  }
  for (const r of arr(input.seriesPrefs)) {
    if (!isRec(r) || !str(r.seriesKey)) continue;
    doc.seriesPrefs.push({
      seriesKey: str(r.seriesKey),
      name: str(r.name),
      prefs: sanitizePrefs(r.prefs),
      updatedAt: num(r.updatedAt),
      deviceId: str(r.deviceId, 64) || undefined,
    });
  }
  for (const r of arr(input.bookPrefs)) {
    if (!isRec(r) || !KEY.test(str(r.contentKey))) continue;
    const overrides = arr(r.overrides)
      .filter(isRec)
      .filter(
        (o) =>
          (o.kind === 'single' || o.kind === 'spreadStart' || o.kind === 'hidden') &&
          typeof o.index === 'number',
      )
      .map((o) => ({ index: num(o.index, 0, 100_000), kind: o.kind as OverrideKind }));
    doc.bookPrefs.push({
      contentKey: r.contentKey as string,
      prefs: sanitizePrefs(r.prefs),
      overrides,
      updatedAt: num(r.updatedAt),
      deviceId: str(r.deviceId, 64) || undefined,
    });
  }
  for (const r of arr(input.collections)) {
    if (!isRec(r) || !str(r.id, 64)) continue;
    doc.collections.push({
      id: str(r.id, 64),
      name: str(r.name, 200),
      bookKeys: arr(r.bookKeys)
        .map((k) => str(k, 64))
        .filter((k) => KEY.test(k)),
      seriesKeys: arr(r.seriesKeys)
        .map((k) => str(k))
        .filter(Boolean),
      updatedAt: num(r.updatedAt),
      deleted: r.deleted === true ? true : undefined,
      deviceId: str(r.deviceId, 64) || undefined,
    });
  }
  return doc;
}
