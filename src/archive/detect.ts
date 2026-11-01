import type { BookFormat } from '../core/types.ts';

/** Detect container format from the first bytes (never from the extension). */
export function detectFormat(head: Uint8Array): BookFormat | null {
  const s = (o: number, str: string) => [...str].every((c, i) => head[o + i] === c.charCodeAt(0));
  if (s(0, 'PK') && (head[2] === 3 || head[2] === 5 || head[2] === 7)) return 'zip';
  if (s(0, 'Rar!')) return 'rar';
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return '7z';
  if (s(0, '%PDF')) return 'pdf';
  if (
    (head[0] === 0xff && head[1] === 0xd8) ||
    s(1, 'PNG') ||
    s(0, 'GIF8') ||
    (s(0, 'RIFF') && s(8, 'WEBP'))
  ) {
    return 'image';
  }
  return null;
}
