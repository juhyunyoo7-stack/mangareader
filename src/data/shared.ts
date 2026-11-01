import { importFiles } from './importer.ts';
import { dir, listNames } from './opfs.ts';

/** Pick up files delivered by the Android share target (OPFS shared/) and import them. */
export async function importSharedFiles(): Promise<number> {
  const names = await listNames(['shared']);
  if (names.length === 0) return 0;
  const d = await dir(['shared']);
  const files: File[] = [];
  for (const n of names) {
    try {
      files.push(await (await d.getFileHandle(n)).getFile());
    } catch {
      /* vanished */
    }
  }
  const results = await importFiles(files);
  for (const n of names) await d.removeEntry(n).catch(() => undefined);
  return results.filter((r) => r.status === 'added').length;
}
