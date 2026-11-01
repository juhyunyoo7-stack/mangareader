import type { Analysis } from '../archive/analyze.ts';
import type { ArchiveErrorCode } from '../archive/errors.ts';
import { ulid } from '../core/id.ts';
import type { Book, SourceRecord } from '../core/types.ts';
import { bumpLibrary, importJobs, pushToast, updateJob } from '../app/store.ts';
import { getImportWorker } from '../workers/clients.ts';
import { RpcError } from '../workers/rpc.ts';
import { applyPendingState } from './backup.ts';
import { handlePermission, resolveBookSource } from './bookSource.ts';
import { buildBook } from './bookFactory.ts';
import { getDb } from './db.ts';
import { makeCover } from './importer.ts';
import { bookPath, removePath, safeSegment } from './opfs.ts';
import { addBook, deleteBook, getBook, listBooks, patchBook } from './repo.ts';
import { S } from '../strings.ts';

const ARCHIVE_EXT = /\.(cbz|zip|cbr|rar|cb7|7z|pdf|epub)$/i;

type Win = Window & {
  showDirectoryPicker?: (o?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (o?: {
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

export interface ScanResult {
  added: number;
  skipped: number;
  unsupported: number;
  failed: number;
  missing: number;
}

interface Found {
  path: string[];
  handle: FileSystemFileHandle;
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string[],
  out: Found[],
  counts: { unsupported: number },
  depth = 0,
): Promise<void> {
  if (depth > 12) return;
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') {
      await walk(h as FileSystemDirectoryHandle, [...prefix, name], out, counts, depth + 1);
    } else if (ARCHIVE_EXT.test(name)) {
      out.push({ path: [...prefix, name], handle: h as FileSystemFileHandle });
    }
  }
}

function errText(e: unknown): string {
  if (e instanceof RpcError && e.code && e.code in S.archiveError)
    return S.archiveError[e.code as ArchiveErrorCode];
  return e instanceof Error ? e.message : 'failed';
}

async function registerHandleBook(
  src: SourceRecord,
  path: string[],
  file: File,
  folderSeries: string | undefined,
  prev?: Book,
): Promise<'added' | 'skipped'> {
  const w = getImportWorker();
  const { analysis } = await w.call<{ analysis: Analysis; size: number }>('analyzeFile', { file });
  if (prev) {
    if (prev.contentKey === analysis.contentKey) {
      // only metadata on disk changed (touch, copy): keep progress and everything else
      await patchBook(prev.id, { size: file.size, mtime: file.lastModified, missing: false });
      return 'skipped';
    }
    await deleteBook(prev.id);
  }
  const existing = (await listBooks()).find((b) => b.contentKey === analysis.contentKey);
  if (existing) {
    // same content already known: point it at this source if it has no readable location
    if (existing.location.kind === 'offloaded' || existing.missing) {
      await patchBook(existing.id, {
        location: { kind: 'handle', sourceId: src.id, path },
        missing: false,
        size: file.size,
        mtime: file.lastModified,
      });
      return 'added';
    }
    return 'skipped';
  }
  const id = ulid();
  const hasCover = await makeCover(id, { file }, analysis);
  const built = buildBook({
    id,
    analysis,
    fileName: path[path.length - 1]!,
    size: file.size,
    mtime: file.lastModified,
    location: { kind: 'handle', sourceId: src.id, path },
    folderSeries,
    hasCover,
  });
  const book = await addBook(built.book, built.series);
  await applyPendingState(book);
  return 'added';
}

/** Recursively scan a directory source: add new books by reference, flag missing ones. */
export async function scanSource(sourceId: string): Promise<ScanResult> {
  const db = await getDb();
  const src = await db.get('sources', sourceId);
  const result: ScanResult = { added: 0, skipped: 0, unsupported: 0, failed: 0, missing: 0 };
  if (!src?.handle || src.handle.kind !== 'directory') return result;
  if ((await handlePermission(src.handle)) !== 'granted') throw new Error('permission');
  const jobId = ulid();
  importJobs.value = [
    ...importJobs.value,
    { id: jobId, name: `Scanning ${src.name}`, bytes: 0, total: 0, status: 'analyzing' },
  ];
  try {
    const found: Found[] = [];
    const counts = { unsupported: 0 };
    await walk(src.handle as FileSystemDirectoryHandle, [], found, counts);
    result.unsupported = counts.unsupported;
    // a folder with several archives is treated as one series named after the folder
    const perDir = new Map<string, number>();
    for (const f of found) {
      const d = f.path.slice(0, -1).join('/');
      perDir.set(d, (perDir.get(d) ?? 0) + 1);
    }
    const known = (await listBooks()).filter(
      (b) => b.location.kind === 'handle' && b.location.sourceId === sourceId,
    );
    const byPath = new Map(
      known.map((b) => [(b.location as { path: string[] }).path.join('/'), b]),
    );
    const seen = new Set<string>();
    let i = 0;
    for (const f of found) {
      i++;
      updateJob(jobId, { name: `Scanning ${src.name} (${i}/${found.length})` });
      const key = f.path.join('/');
      seen.add(key);
      try {
        const file = await f.handle.getFile();
        const prev = byPath.get(key);
        if (prev && prev.size === file.size && prev.mtime === file.lastModified) {
          if (prev.missing) await patchBook(prev.id, { missing: false });
          result.skipped++;
          continue;
        }
        const dir = f.path.slice(0, -1);
        const folderSeries =
          dir.length > 0 && (perDir.get(dir.join('/')) ?? 0) > 1 ? dir[dir.length - 1] : undefined;
        const r = await registerHandleBook(src, f.path, file, folderSeries, prev);
        if (r === 'added') result.added++;
        else result.skipped++;
      } catch {
        result.failed++;
      }
    }
    for (const b of known) {
      const key = (b.location as { path: string[] }).path.join('/');
      if (!seen.has(key) && !b.missing) {
        await patchBook(b.id, { missing: true });
        result.missing++;
      }
    }
    await db.put('sources', { ...src, lastScanAt: Date.now() });
    updateJob(jobId, { status: 'done', name: S.scanned(src.name) });
  } catch (e) {
    updateJob(jobId, { status: 'failed', message: errText(e) });
    throw e;
  } finally {
    bumpLibrary();
  }
  return result;
}

export function reportScan(name: string, r: ScanResult): void {
  const parts = [S.scanAdded(r.added)];
  if (r.skipped) parts.push(S.scanUnchanged(r.skipped));
  if (r.missing) parts.push(S.scanMissing(r.missing));
  if (r.failed) parts.push(S.scanFailed(r.failed));
  if (r.unsupported) parts.push(S.scanUnsupported(r.unsupported));
  pushToast(`${name}: ${parts.join(', ')}.`, r.failed ? 'error' : 'success', 8000);
}

async function addDirectorySource(handle: FileSystemDirectoryHandle): Promise<string> {
  const db = await getDb();
  // the same folder picked twice reuses its source
  for (const s of await db.getAll('sources')) {
    if (s.handle && (await s.handle.isSameEntry(handle).catch(() => false))) return s.id;
  }
  const src: SourceRecord = {
    id: ulid(),
    kind: 'fsaDir',
    name: handle.name,
    handle,
    addedAt: Date.now(),
  };
  await db.put('sources', src);
  return src.id;
}

/** Add a dropped directory handle as a library source and scan it. */
export async function addDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const id = await addDirectorySource(handle);
  reportScan(handle.name, await scanSource(id));
}

/** "Add library folder" (Chromium desktop/Android). Returns false if the user cancelled. */
export async function addLibraryFolder(): Promise<boolean> {
  const picker = (window as Win).showDirectoryPicker;
  if (!picker) return false;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker.call(window, { mode: 'read' });
  } catch {
    return false; // dismissed
  }
  const id = await addDirectorySource(handle);
  const r = await scanSource(id);
  reportScan(handle.name, r);
  return true;
}

/** Reference-in-place import of individual files (open picker, drag & drop, launchQueue). */
export async function importFileHandles(handles: FileSystemFileHandle[]): Promise<void> {
  const db = await getDb();
  let added = 0;
  let skipped = 0;
  for (const h of handles) {
    try {
      const file = await h.getFile();
      if (!ARCHIVE_EXT.test(file.name)) {
        pushToast(S.onlyInPlace(file.name), 'error');
        continue;
      }
      const src: SourceRecord = {
        id: ulid(),
        kind: 'fsaFile',
        name: h.name,
        handle: h,
        addedAt: Date.now(),
      };
      await db.put('sources', src);
      const r = await registerHandleBook(src, [], file, undefined);
      if (r === 'added') added++;
      else {
        skipped++;
        await db.delete('sources', src.id);
      }
    } catch (e) {
      pushToast(`${h.name}: ${errText(e)}`, 'error');
    }
  }
  bumpLibrary();
  if (added) pushToast(S.addedInPlace(added), 'success');
  if (skipped) pushToast(S.skippedInLibrary(skipped), 'info');
}

export async function openFilesInPlace(): Promise<boolean> {
  const picker = (window as Win).showOpenFilePicker;
  if (!picker) return false;
  try {
    const hs = await picker.call(window, { multiple: true });
    await importFileHandles(hs);
    return true;
  } catch {
    return false;
  }
}

// ---- sources: listing, reconnect, removal ------------------------------------------------------
export interface SourceStatus {
  source: SourceRecord;
  permission: PermissionState;
  bookCount: number;
}

export async function listSourceStatus(): Promise<SourceStatus[]> {
  const db = await getDb();
  const books = await listBooks();
  const out: SourceStatus[] = [];
  for (const s of await db.getAll('sources')) {
    if (s.kind === 'opfs') continue;
    const perm = s.handle
      ? await handlePermission(s.handle).catch(() => 'denied' as PermissionState)
      : 'denied';
    out.push({
      source: s,
      permission: perm,
      bookCount: books.filter((b) => b.location.kind === 'handle' && b.location.sourceId === s.id)
        .length,
    });
  }
  return out;
}

/** Must be called from a user gesture (click). */
export async function reconnectSource(sourceId: string): Promise<boolean> {
  const src = await (await getDb()).get('sources', sourceId);
  if (!src?.handle) return false;
  const state = await handlePermission(src.handle, true);
  if (state !== 'granted') return false;
  if (src.kind === 'fsaDir') {
    const r = await scanSource(sourceId);
    reportScan(src.name, r);
  }
  bumpLibrary();
  return true;
}

export async function removeSource(sourceId: string): Promise<void> {
  const db = await getDb();
  for (const b of await listBooks()) {
    if (b.location.kind === 'handle' && b.location.sourceId === sourceId) {
      await removePath(['thumbs', b.id]);
      await deleteBook(b.id);
    }
  }
  await db.delete('sources', sourceId);
  bumpLibrary();
}

/** Copy a reference-in-place book into app storage so it works offline / without the folder. */
export async function copyBookIntoStorage(book: Book): Promise<void> {
  if (book.location.kind !== 'handle') return;
  const src = await resolveBookSource(book);
  if (!src.file) return;
  const w = getImportWorker();
  const tmpId = ulid();
  const name = safeSegment(book.fileName);
  await w.call('importFile', { tmpId, file: src.file });
  await w.call('commit', { tmpId, bookId: book.id, name });
  const fresh = await getBook(book.id);
  if (fresh) {
    await patchBook(book.id, {
      location: { kind: 'opfs', path: bookPath(book.id, name).join('/') },
      missing: false,
    });
  }
  bumpLibrary();
}
