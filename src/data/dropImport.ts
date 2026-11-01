import { addDirectoryHandle, importFileHandles } from './fsa.ts';

type HandleItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};
type LaunchQueue = { setConsumer(fn: (p: { files: FileSystemFileHandle[] }) => void): void };

/**
 * Drag & drop of files/folders onto the window, and File Handling API (launchQueue).
 * Where `getAsFileSystemHandle` exists, files are opened in place (no copy); otherwise the plain
 * File objects are copied into app storage via `onFiles`.
 */
export function setupDropAndLaunch(onFiles: (files: File[]) => void): () => void {
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.add('dragging');
  };
  const leave = (e: DragEvent) => {
    if (e.relatedTarget === null) document.body.classList.remove('dragging');
  };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.remove('dragging');
    const dt = e.dataTransfer;
    if (!dt) return;
    const items = [...dt.items].filter((i) => i.kind === 'file') as HandleItem[];
    const files = [...dt.files];
    if (items.length > 0 && items.every((i) => typeof i.getAsFileSystemHandle === 'function')) {
      // all handle promises must be requested synchronously, before the event ends
      const promises = items.map((i) => i.getAsFileSystemHandle!().catch(() => null));
      void (async () => {
        const handles = (await Promise.all(promises)).filter(
          (h): h is FileSystemHandle => h !== null,
        );
        if (handles.length === 0) {
          onFiles(files);
          return;
        }
        const fileHandles = handles.filter((h): h is FileSystemFileHandle => h.kind === 'file');
        const nonZip: FileSystemFileHandle[] = [];
        const zips: FileSystemFileHandle[] = [];
        for (const h of fileHandles) (/\.(cbz|zip)$/i.test(h.name) ? zips : nonZip).push(h);
        if (zips.length) await importFileHandles(zips);
        for (const d of handles)
          if (d.kind === 'directory') await addDirectoryHandle(d as FileSystemDirectoryHandle);
        if (nonZip.length)
          onFiles(await Promise.all(nonZip.map((h) => (h as FileSystemFileHandle).getFile())));
      })();
      return;
    }
    onFiles(files);
  };
  window.addEventListener('dragover', over);
  window.addEventListener('dragleave', leave);
  window.addEventListener('drop', drop);
  const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  lq?.setConsumer((params) => {
    if (params.files?.length) void importFileHandles(params.files);
  });
  return () => {
    window.removeEventListener('dragover', over);
    window.removeEventListener('dragleave', leave);
    window.removeEventListener('drop', drop);
  };
}
