// Pure string parsing for image-based (fixed-layout / comic) EPUBs. No DOMParser: this runs in workers.

const attrRe = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attrs(tagBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tagBody.matchAll(attrRe)) out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? '';
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `full-path` of the first rootfile in META-INF/container.xml. */
export function parseContainer(xml: string): string | undefined {
  const m = /<rootfile\b([^>]*)>/i.exec(xml);
  const p = m ? attrs(m[1]!)['full-path'] : undefined;
  return p ? decodeEntities(p) : undefined;
}

export interface Opf {
  manifest: Map<string, { href: string; type: string }>;
  spine: string[];
  rtl: boolean;
  title?: string;
}

export function parseOpf(xml: string): Opf {
  const manifest = new Map<string, { href: string; type: string }>();
  for (const m of xml.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const a = attrs(m[1]!);
    if (a.id && a.href) {
      manifest.set(a.id, { href: decodeEntities(a.href), type: a['media-type'] ?? '' });
    }
  }
  const spineTag = /<spine\b([^>]*)>/i.exec(xml);
  const rtl = (spineTag ? attrs(spineTag[1]!)['page-progression-direction'] : '') === 'rtl';
  const spine: string[] = [];
  for (const m of xml.matchAll(/<itemref\b([^>]*?)\/?>/gi)) {
    const id = attrs(m[1]!).idref;
    if (id) spine.push(id);
  }
  const t = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml)?.[1]?.trim();
  return { manifest, spine, rtl, title: t ? decodeEntities(t) : undefined };
}

/** href of the first <img src> or <svg><image href|xlink:href> in a page. */
export function firstImageRef(xhtml: string): string | undefined {
  const re = /<(img|image)\b([^>]*?)\/?>/gi;
  for (const m of xhtml.matchAll(re)) {
    const a = attrs(m[2]!);
    const ref = m[1]!.toLowerCase() === 'img' ? a.src : (a['xlink:href'] ?? a.href);
    if (ref && !/^(data:|https?:)/i.test(ref)) return decodeEntities(ref);
  }
  return undefined;
}

/** Visible text length of a page (head, scripts, styles and tags removed, whitespace collapsed). */
export function textLength(xhtml: string): number {
  const body = xhtml
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(body).replace(/\s+/g, ' ').trim().length;
}

/** Resolve `ref` relative to the file at `baseFile`; strips query/fragment and percent-decoding. */
export function resolveZipPath(baseFile: string, ref: string): string {
  let r = ref.split('#')[0]!.split('?')[0]!;
  try {
    r = decodeURIComponent(r);
  } catch {
    /* keep raw */
  }
  const parts = r.startsWith('/') ? [] : baseFile.split('/').slice(0, -1);
  for (const seg of r.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
