import { ArchiveError } from '../errors.ts';
import {
  firstImageRef,
  parseContainer,
  parseOpf,
  resolveZipPath,
  textLength,
} from './epubParse.ts';

export interface EpubPages {
  /** zip entry name of the page image, in spine order */
  images: string[];
  rtl: boolean;
  title?: string;
}

const TEXT_CHARS = 200;
const TEXT_SHARE = 0.3;

export function isEpubEntryList(names: string[]): boolean {
  return names.includes('META-INF/container.xml');
}

/**
 * Page list of an image-based EPUB: spine order, one image per spine item (first <img>/<svg image>).
 * Rejects text EPUBs: more than 30% of spine items without an image, or with over 200 characters of text.
 */
export async function resolveEpubPages(
  entryNames: Set<string>,
  readText: (name: string) => Promise<string>,
): Promise<EpubPages> {
  const opfPath = parseContainer(await readText('META-INF/container.xml'));
  if (!opfPath || !entryNames.has(opfPath)) throw new ArchiveError('bad-entry');
  const opf = parseOpf(await readText(opfPath));
  if (opf.spine.length === 0) throw new ArchiveError('no-images');
  const images: string[] = [];
  let bad = 0;
  for (const id of opf.spine) {
    const item = opf.manifest.get(id);
    const pagePath = item ? resolveZipPath(opfPath, item.href) : undefined;
    if (!pagePath || !entryNames.has(pagePath)) {
      bad++;
      continue;
    }
    if (!/x?html|xml/i.test(item!.type) && !/\.x?html?$/i.test(pagePath)) {
      // spine item that is itself an image (allowed by some fixed-layout producers)
      if (/^image\//i.test(item!.type)) images.push(pagePath);
      else bad++;
      continue;
    }
    const html = await readText(pagePath);
    const ref = firstImageRef(html);
    const img = ref ? resolveZipPath(pagePath, ref) : undefined;
    if (!img || !entryNames.has(img) || textLength(html) > TEXT_CHARS) {
      bad++;
      continue;
    }
    images.push(img);
  }
  if (images.length === 0 || bad / opf.spine.length > TEXT_SHARE) {
    throw new ArchiveError('text-epub');
  }
  return { images, rtl: opf.rtl, title: opf.title };
}
