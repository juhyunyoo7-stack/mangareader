export interface ParsedName {
  series: string;
  seriesKey: string;
  title: string;
  volume?: number;
  chapter?: number;
  number?: number;
}

const KNOWN_EXT = /\.(cbz|cbr|cb7|cbt|zip|rar|7z|pdf|epub|jpe?g|png|webp|avif|gif)$/i;

/** NFKC, lowercase, punctuation collapsed - the grouping key for series. */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripExtension(name: string): string {
  return name.replace(KNOWN_EXT, '');
}

function stripBrackets(s: string): string {
  let prev: string;
  let cur = s;
  do {
    prev = cur;
    cur = cur
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/\{[^}]*\}/g, ' ');
  } while (cur !== prev);
  return cur;
}

function tidy(s: string): string {
  return s
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, '')
    .trim();
}

interface Token {
  index: number;
  kind: 'volume' | 'chapter' | 'number';
  value: number;
}

const VOL_PATTERNS: RegExp[] = [
  /(?:^|[\s_.\-])(?:vol(?:ume)?|v|tome|band)\.?\s*(\d{1,4}(?:\.\d+)?)(?![\p{L}\d])/giu,
  /第\s*(\d{1,4})\s*[巻卷]/gu,
  /(\d{1,4})\s*[巻卷](?![\p{L}])/gu,
  /(\d{1,4})\s*권/gu,
];
const CH_PATTERNS: RegExp[] = [
  /(?:^|[\s_.\-])(?:ch(?:apter)?|c)\.?\s*(\d{1,4}(?:\.\d+)?)(?![\p{L}\d])/giu,
  /第\s*(\d{1,4}(?:\.\d+)?)\s*話/gu,
  /(\d{1,4})\s*[話话]/gu,
  /(\d{1,4})\s*화/gu,
];
const NUM_PATTERNS: RegExp[] = [/#\s*(\d{1,4}(?:\.\d+)?)/gu];

function collect(s: string, pats: RegExp[], kind: Token['kind']): Token[] {
  const out: Token[] = [];
  for (const re of pats) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      const full = m[0];
      // index of the token start (skip a leading separator that is part of the match)
      const lead = /^[\s_.\-]/.test(full) ? 1 : 0;
      out.push({ index: (m.index ?? 0) + lead, kind, value: parseFloat(m[1]!) });
    }
  }
  return out;
}

export function parseFileName(fileName: string, opts: { folderSeries?: string } = {}): ParsedName {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  let s = stripBrackets(stripExtension(base));
  // "Some.Title.v01" style: dots as word separators when there are no spaces
  if (!/\s/.test(s) && (s.match(/\./g) ?? []).length >= 2) s = s.replace(/\./g, ' ');
  s = tidy(s.replace(/_/g, ' '));
  const title = s;
  const tokens = [
    ...collect(s, VOL_PATTERNS, 'volume'),
    ...collect(s, CH_PATTERNS, 'chapter'),
    ...collect(s, NUM_PATTERNS, 'number'),
  ].sort((a, b) => a.index - b.index);

  let volume: number | undefined;
  let chapter: number | undefined;
  let number: number | undefined;
  let cut = s.length;
  for (const t of tokens) {
    if (t.kind === 'volume' && volume === undefined) volume = t.value;
    if (t.kind === 'chapter' && chapter === undefined) chapter = t.value;
    if (t.kind === 'number' && number === undefined) number = t.value;
    cut = Math.min(cut, t.index);
  }
  if (tokens.length === 0) {
    const m = /^(.*?)[\s\-–—_.]+(\d{1,4})$/u.exec(s);
    if (m && m[1]!.trim() !== '') {
      volume = parseInt(m[2]!, 10);
      cut = m[1]!.length;
    }
  }
  let series = tidy(s.slice(0, cut));
  if (series === '') series = opts.folderSeries ? tidy(opts.folderSeries) : title;
  if (series === '') series = tidy(base) || base;
  if (opts.folderSeries && normalizeKey(opts.folderSeries) !== '') {
    series = tidy(opts.folderSeries);
  }
  return { series, seriesKey: normalizeKey(series), title: title || base, volume, chapter, number };
}

/** Sort key making numbers sort naturally ("v2" < "v10"). */
export function titleSortKey(title: string): string {
  return normalizeKey(title).replace(/\d+/g, (d) => d.padStart(6, '0'));
}
