import type { Book } from '../core/types.ts';
import { getDb } from './db.ts';
import { S } from '../strings.ts';

export type SourceErrorKind = 'offloaded' | 'permission' | 'missing' | 'broken';

export class SourceError extends Error {
  readonly kind: SourceErrorKind;
  constructor(kind: SourceErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

type PermHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export async function handlePermission(
  h: FileSystemHandle,
  request = false,
): Promise<PermissionState> {
  const ph = h as PermHandle;
  if (!ph.queryPermission) return 'granted'; // OPFS-backed or test handles
  let state = await ph.queryPermission({ mode: 'read' });
  if (state !== 'granted' && request && ph.requestPermission) {
    state = await ph.requestPermission({ mode: 'read' });
  }
  return state;
}

export interface ResolvedSource {
  file?: File;
  opfsPath?: string[];
}

/** Where the bytes of a book live right now, or a typed reason why they are unavailable. */
export async function resolveBookSource(book: Book): Promise<ResolvedSource> {
  if (book.broken) throw new SourceError('broken', book.broken.reason);
  const loc = book.location;
  if (loc.kind === 'offloaded') {
    throw new SourceError('offloaded', S.sourceOffloaded);
  }
  if (loc.kind === 'opfs') return { opfsPath: loc.path.split('/') };
  const db = await getDb();
  const src = await db.get('sources', loc.sourceId);
  if (!src?.handle) throw new SourceError('missing', S.sourceRemoved);
  if ((await handlePermission(src.handle)) !== 'granted') {
    throw new SourceError('permission', S.sourcePermission);
  }
  try {
    if (src.handle.kind === 'file') {
      return { file: await (src.handle as FileSystemFileHandle).getFile() };
    }
    let d = src.handle as FileSystemDirectoryHandle;
    for (const seg of loc.path.slice(0, -1)) d = await d.getDirectoryHandle(seg);
    const fh = await d.getFileHandle(loc.path[loc.path.length - 1]!);
    return { file: await fh.getFile() };
  } catch {
    throw new SourceError('missing', S.sourceMissing);
  }
}
