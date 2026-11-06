import { detectFormat } from '../archive/detect.ts';
import type { ArchiveErrorCode } from '../archive/errors.ts';
import type { Analysis } from '../archive/analyze.ts';
import { ulid } from '../core/id.ts';
import type { Book } from '../core/types.ts';
import { bumpLibrary, importJobs, updateJob, type ImportJob } from '../app/store.ts';
import { getImportWorker } from '../workers/clients.ts';
import { RpcError } from '../workers/rpc.ts';
import { applyPendingState } from './backup.ts';
import { buildBook } from './bookFactory.ts';
import { newestMtime, splitImages, type ImageGroup } from './imageBundle.ts';
import { bookPath, removePath, safeSegment, storageEstimate } from './opfs.ts';
import { addBook, getBookByKey, patchBook } from './repo.ts';
import { S } from '../strings.ts';

export type ImportStatus = 'added' | 'duplicate' | 'reattached' | 'failed' | 'cancelled';
export interface ImportOutcome {
  name: string;
  status: ImportStatus;
  bookId?: string;
  message?: string;
}

function errorText(e: unknown): string {
  if (e instanceof RpcError && e.code && e.code in S.archiveError)
    return S.archiveError[e.code as ArchiveErrorCode];
  return e instanceof Error ? e.message : S.importFailedShort;
}

let activeTmpId: string | undefined;

/** Ask the worker to stop the import currently copying. */
export function cancelActiveImport(): void {
  if (activeTmpId)
    getImportWorker()
      .call('cancel', { tmpId: activeTmpId })
      .catch(() => undefined);
}

/** Remove half-imported files left by a crash or reload (called at startup). */
export async function cleanupIncoming(): Promise<void> {
  try {
    await getImportWorker().call('cleanupIncoming', {});
  } catch {
    /* worker unavailable */
  }
}

/** One thing to import: a picked file, or a group of loose page images bundled into a CBZ. */
type Source = { file: File; images?: undefined } | { file?: undefined; images: ImageGroup };

const sourceName = (s: Source) => (s.images ? `${s.images.name}.cbz` : s.file.name);
const sourceSize = (s: Source) =>
  s.images ? s.images.files.reduce((n, f) => n + f.size, 0) : s.file.size;

export async function importFiles(picked: File[]): Promise<ImportOutcome[]> {
  // loose page images -> one CBZ per folder / selection (streamed into OPFS by the worker)
  const { groups, rest } = await splitImages(
    picked,
    S.imageBookName(new Date().toISOString().slice(0, 10)),
  );
  const sources: Source[] = [
    ...groups.map((images) => ({ images })),
    ...rest.map((file) => ({ file })),
  ];
  const jobs: { src: Source; job: ImportJob }[] = sources.map((src) => ({
    src,
    job: { id: ulid(), name: sourceName(src), bytes: 0, total: sourceSize(src), status: 'queued' },
  }));
  importJobs.value = [...importJobs.value, ...jobs.map((j) => j.job)];
  const out: ImportOutcome[] = [];
  for (const { src, job } of jobs) {
    out.push(await importOne(src, job));
  }
  bumpLibrary();
  return out;
}

async function importOne(src: Source, job: ImportJob): Promise<ImportOutcome> {
  const fileName = sourceName(src);
  const fileSize = sourceSize(src);
  const fail = (message: string, status: ImportStatus = 'failed'): ImportOutcome => {
    updateJob(job.id, { status: status === 'cancelled' ? 'cancelled' : 'failed', message });
    return { name: fileName, status, message };
  };
  if (src.file) {
    const file = src.file;
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const fmt = detectFormat(head);
    if (fmt !== 'zip' && fmt !== 'rar' && fmt !== '7z' && fmt !== 'pdf') {
      return fail(S.unsupportedFile);
    }
  }
  const est = await storageEstimate();
  if (est.quota > 0 && est.quota - est.usage < fileSize * 1.1) {
    return fail(S.notEnoughStorage);
  }
  const tmpId = ulid();
  activeTmpId = tmpId;
  const w = getImportWorker();
  const off = w.on<{ tmpId: string; bytes: number; total: number }>('progress', (p) => {
    if (p.tmpId === tmpId) updateJob(job.id, { bytes: p.bytes, total: p.total, status: 'copying' });
  });
  try {
    updateJob(job.id, { status: 'copying' });
    const { analysis, size } = await w.call<{ analysis: Analysis; size: number }>(
      'importFile',
      src.images ? { tmpId, images: src.images.files } : { tmpId, file: src.file },
    );
    updateJob(job.id, { status: 'analyzing' });
    const existing = await getBookByKey(analysis.contentKey);
    if (existing && existing.location.kind !== 'offloaded') {
      await w.call('discard', { tmpId });
      updateJob(job.id, { status: 'failed', message: S.alreadyInLibrary });
      return {
        name: fileName,
        status: 'duplicate',
        bookId: existing.id,
        message: S.alreadyInLibrary,
      };
    }
    const bookId = existing?.id ?? ulid();
    const name = safeSegment(fileName);
    await w.call('commit', { tmpId, bookId, name });
    const location = { kind: 'opfs' as const, path: bookPath(bookId, name).join('/') };
    if (existing) {
      await patchBook(existing.id, { location, fileName: name, size, missing: false });
      updateJob(job.id, { status: 'done' });
      return { name: fileName, status: 'reattached', bookId };
    }
    const hasCover = await makeCover(bookId, { opfsPath: bookPath(bookId, name) }, analysis);
    const built = buildBook({
      id: bookId,
      analysis,
      fileName: name,
      size,
      mtime: src.images ? newestMtime(src.images.files) : src.file.lastModified,
      location,
      hasCover,
    });
    let book: Book;
    try {
      book = await addBook(built.book, built.series);
    } catch (e) {
      await removePath(['books', bookId]);
      throw e;
    }
    await applyPendingState(book);
    updateJob(job.id, { status: 'done' });
    return { name: fileName, status: 'added', bookId };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'cancelled') return fail(S.importCancelled, 'cancelled');
    return fail(errorText(e));
  } finally {
    off();
    activeTmpId = undefined;
  }
}

/** Generate the cover thumbnail in the worker; false when unsupported. */
export async function makeCover(
  bookId: string,
  src: { file?: File; opfsPath?: string[] },
  analysis: Analysis,
): Promise<boolean> {
  try {
    return await getImportWorker().call<boolean>('makeCover', {
      bookId,
      entry: analysis.pages[0]!.entry,
      ...src,
    });
  } catch {
    return false;
  }
}
