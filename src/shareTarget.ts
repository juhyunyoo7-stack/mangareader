/** Android Web Share Target handler: stores shared files in OPFS `shared/` for the app to import. */
export interface ShareStore {
  save(name: string, file: Blob): Promise<void>;
}

const MAX_SHARED_FILES = 50;

export function safeSharedName(name: string, index: number): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return `${Date.now().toString(36)}-${index}-${cleaned || 'shared.bin'}`;
}

/** Returns number of files stored. */
export async function handleShare(request: Request, store: ShareStore): Promise<number> {
  const form = await request.formData();
  let n = 0;
  for (const value of form.getAll('books')) {
    if (typeof value === 'string') continue;
    if (n >= MAX_SHARED_FILES) break;
    await store.save(safeSharedName((value as File).name, n), value);
    n++;
  }
  return n;
}

export function opfsShareStore(): ShareStore {
  return {
    async save(name, file) {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('shared', { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await file.stream().pipeTo(w);
    },
  };
}
