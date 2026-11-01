/** OPFS layout: books/<bookId>/<fileName>, incoming/<tmpId>, thumbs/<bookId>/cover.webp, shared/. */
export async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export async function dir(
  path: string[],
  create = false,
  root?: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  let d = root ?? (await opfsRoot());
  for (const p of path) d = await d.getDirectoryHandle(p, { create });
  return d;
}

/** Safe single path segment for a file name coming from the outside world. */
export function safeSegment(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200);
  return cleaned || 'book.cbz';
}

export function bookPath(bookId: string, fileName: string): string[] {
  return ['books', bookId, safeSegment(fileName)];
}

export async function getOpfsFile(path: string[]): Promise<File> {
  const d = await dir(path.slice(0, -1));
  const fh = await d.getFileHandle(path[path.length - 1]!);
  return fh.getFile();
}

export async function removePath(path: string[]): Promise<void> {
  try {
    const parent = await dir(path.slice(0, -1));
    await parent.removeEntry(path[path.length - 1]!, { recursive: true });
  } catch {
    /* already gone */
  }
}

export async function listNames(path: string[]): Promise<string[]> {
  try {
    const d = await dir(path);
    const out: string[] = [];
    for await (const k of d.keys()) out.push(k as string);
    return out;
  } catch {
    return [];
  }
}

export async function writeBlob(path: string[], data: Blob): Promise<void> {
  const d = await dir(path.slice(0, -1), true);
  const fh = await d.getFileHandle(path[path.length - 1]!, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const e = (await navigator.storage?.estimate?.()) ?? {};
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Remove everything under OPFS root. */
export async function wipeOpfs(): Promise<void> {
  const root = await opfsRoot();
  for (const name of await listNames([])) {
    await root.removeEntry(name, { recursive: true }).catch(() => undefined);
  }
}
