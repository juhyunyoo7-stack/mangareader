import { ArchiveError } from '../errors.ts';

/** Anything sliceable: Blob / File (FSA or OPFS) or a test double. */
export interface SliceSource {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface ZipEntry {
  name: string;
  /** raw bytes of the name as stored */
  rawName: Uint8Array;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  isDirectory: boolean;
  encrypted: boolean;
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  /** ratio check only applies to entries bigger than this many bytes */
  ratioMinBytes: number;
  maxRatio: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 512 * 1024 * 1024,
  ratioMinBytes: 2 * 1024 * 1024,
  maxRatio: 300,
};

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const EOCD64_SIG = 0x06064b50;
const LOC64_SIG = 0x07064b50;

async function read(src: SliceSource, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end > src.size || start > end) throw new ArchiveError('truncated');
  return new Uint8Array(await src.slice(start, end).arrayBuffer());
}

function u16(dv: DataView, o: number) {
  return dv.getUint16(o, true);
}
function u32(dv: DataView, o: number) {
  return dv.getUint32(o, true);
}
function u64(dv: DataView, o: number): number {
  const v = dv.getBigUint64(o, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveError('too-large');
  return Number(v);
}

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

function isValidUtf8(raw: Uint8Array): boolean {
  try {
    utf8Fatal.decode(raw);
    return true;
  } catch {
    return false;
  }
}

/** KS X 1001 EUC-KR: every double-byte sequence has both bytes in 0xA1-0xFE (UHC extensions do not). */
function isStrictEucKr(raw: Uint8Array): boolean {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]! < 0x80) continue;
    const t = raw[i + 1];
    if (raw[i]! < 0xa1 || raw[i]! > 0xfe || t === undefined || t < 0xa1 || t > 0xfe) return false;
    i++;
  }
  return true;
}

type LegacyLabel = 'euc-kr' | 'shift_jis' | 'windows-1252';

const HANGUL = /[가-힣]/g;
const KANA_KANJI = /[぀-ヿ一-鿿]/g;
const HALFWIDTH_KANA = /[｡-ﾟ]/g;

/** How plausible it is that `text` is real Korean (hangul) or Japanese (kana/kanji) filenames. */
function scriptScore(label: LegacyLabel, text: string): number {
  if (label === 'euc-kr') return (text.match(HANGUL) ?? []).length;
  // half-width katakana is almost never used in file names: a decode full of it is a false positive
  return (text.match(KANA_KANJI) ?? []).length - 2 * (text.match(HALFWIDTH_KANA) ?? []).length;
}

/**
 * Pick one legacy code page for the whole archive from all its non-UTF-8 names (an archive is written
 * by one tool, so every unflagged name shares an encoding; deciding per archive keeps sorting stable
 * and avoids names that happen to be valid in two code pages decoding differently).
 */
export function chooseLegacyEncoding(rawNames: Uint8Array[]): LegacyLabel {
  const names = rawNames.filter((r) => r.some((b) => b >= 0x80) && !isValidUtf8(r));
  if (names.length === 0) return 'windows-1252';
  let best: LegacyLabel = 'windows-1252';
  let bestScore = 0;
  const candidates: LegacyLabel[] = ['euc-kr', 'shift_jis'];
  for (const label of candidates) {
    if (label === 'euc-kr' && !names.every(isStrictEucKr)) continue;
    let score = 0;
    try {
      const dec = new TextDecoder(label, { fatal: true });
      for (const r of names) score += scriptScore(label, dec.decode(r));
    } catch {
      continue; // some name is not valid in this code page
    }
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  return best;
}

export function decodeName(
  raw: Uint8Array,
  flags: number,
  unicodeExtra?: string,
  legacy?: LegacyLabel,
): string {
  if (unicodeExtra) return unicodeExtra;
  if ((flags & 0x800) !== 0) return new TextDecoder('utf-8').decode(raw);
  if (raw.every((b) => b < 128)) return String.fromCharCode(...raw);
  if (isValidUtf8(raw)) return new TextDecoder('utf-8').decode(raw);
  const label = legacy ?? chooseLegacyEncoding([raw]);
  try {
    return new TextDecoder(label, { fatal: label !== 'windows-1252' }).decode(raw);
  } catch {
    return new TextDecoder('windows-1252').decode(raw);
  }
}

function parseExtra(
  extra: Uint8Array,
  want: { size: boolean; csize: boolean; offset: boolean },
  e: { size: number; compressedSize: number; localOffset: number },
): string | undefined {
  const dv = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let o = 0;
  let uni: string | undefined;
  while (o + 4 <= extra.length) {
    const id = u16(dv, o);
    const len = u16(dv, o + 2);
    const body = o + 4;
    if (body + len > extra.length) break;
    if (id === 0x0001) {
      let p = body;
      if (want.size && p + 8 <= body + len) {
        e.size = u64(dv, p);
        p += 8;
      }
      if (want.csize && p + 8 <= body + len) {
        e.compressedSize = u64(dv, p);
        p += 8;
      }
      if (want.offset && p + 8 <= body + len) {
        e.localOffset = u64(dv, p);
      }
    } else if (id === 0x7075 && len > 5 && extra[body] === 1) {
      uni = new TextDecoder('utf-8').decode(extra.subarray(body + 5, body + len));
    }
    o = body + len;
  }
  return uni;
}

/**
 * Reads the ZIP central directory using only tail slices (never the whole file).
 * Supports ZIP64. Applies safety limits to declared sizes and entry count.
 */
export async function readZipDirectory(
  src: SliceSource,
  limits: ZipLimits = DEFAULT_LIMITS,
): Promise<ZipEntry[]> {
  if (src.size < 22) throw new ArchiveError('not-zip');
  const tailLen = Math.min(src.size, 22 + 0xffff + 20);
  const tail = await read(src, src.size - tailLen, src.size);
  const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tdv, i) === EOCD_SIG && i + 22 + u16(tdv, i + 20) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    // distinguish "not a zip" from "damaged zip" by looking at the first bytes
    const head = await read(src, 0, Math.min(4, src.size));
    if (head[0] === 0x50 && head[1] === 0x4b) throw new ArchiveError('truncated');
    throw new ArchiveError('not-zip');
  }
  let count = u16(tdv, eocd + 10);
  let cdSize = u32(tdv, eocd + 12);
  let cdOffset = u32(tdv, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = eocd - 20;
    if (locPos >= 0 && u32(tdv, locPos) === LOC64_SIG) {
      const eocd64Off = u64(tdv, locPos + 8);
      const b = await read(src, eocd64Off, Math.min(src.size, eocd64Off + 56));
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      if (b.length < 56 || u32(dv, 0) !== EOCD64_SIG) throw new ArchiveError('truncated');
      count = u64(dv, 32);
      cdSize = u64(dv, 40);
      cdOffset = u64(dv, 48);
    } else {
      throw new ArchiveError('truncated');
    }
  }
  if (count > limits.maxEntries) throw new ArchiveError('too-many-entries');
  if (cdSize > 256 * 1024 * 1024 || cdOffset + cdSize > src.size)
    throw new ArchiveError('truncated');
  const cd = await read(src, cdOffset, cdOffset + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  const pending: { raw: Uint8Array; flags: number; uni?: string }[] = [];
  let o = 0;
  for (let n = 0; n < count; n++) {
    if (o + 46 > cd.length || u32(dv, o) !== CD_SIG) throw new ArchiveError('truncated');
    const flags = u16(dv, o + 8);
    const method = u16(dv, o + 10);
    const crc = u32(dv, o + 16);
    const e = {
      size: u32(dv, o + 24),
      compressedSize: u32(dv, o + 20),
      localOffset: u32(dv, o + 42),
    };
    const nameLen = u16(dv, o + 28);
    const extraLen = u16(dv, o + 30);
    const commentLen = u16(dv, o + 32);
    const end = o + 46 + nameLen + extraLen + commentLen;
    if (end > cd.length) throw new ArchiveError('truncated');
    const rawName = cd.slice(o + 46, o + 46 + nameLen);
    const extra = cd.subarray(o + 46 + nameLen, o + 46 + nameLen + extraLen);
    const uni = parseExtra(
      extra,
      {
        size: e.size === 0xffffffff,
        csize: e.compressedSize === 0xffffffff,
        offset: e.localOffset === 0xffffffff,
      },
      e,
    );
    pending.push({ raw: rawName, flags, uni });
    entries.push({
      name: '',
      rawName,
      method,
      flags,
      crc,
      compressedSize: e.compressedSize,
      size: e.size,
      localOffset: e.localOffset,
      isDirectory: false,
      encrypted: (flags & 1) !== 0,
    });
    o = end;
  }
  // one code page for all unflagged legacy names of this archive
  const legacy = chooseLegacyEncoding(
    pending.filter((p) => !p.uni && (p.flags & 0x800) === 0).map((p) => p.raw),
  );
  entries.forEach((e, i) => {
    const p = pending[i]!;
    e.name = decodeName(p.raw, p.flags, p.uni, legacy);
    e.isDirectory = e.name.endsWith('/');
  });
  return entries;
}

/** Throws if the declared sizes of an entry violate the safety limits. */
export function checkEntryLimits(e: ZipEntry, limits: ZipLimits = DEFAULT_LIMITS): void {
  if (e.encrypted) throw new ArchiveError('encrypted');
  if (e.size > limits.maxEntryBytes) throw new ArchiveError('entry-too-large');
  if (e.size > limits.ratioMinBytes && e.size / Math.max(1, e.compressedSize) > limits.maxRatio) {
    throw new ArchiveError('ratio');
  }
}
