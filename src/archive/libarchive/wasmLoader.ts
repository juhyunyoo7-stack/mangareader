import { libarchiveWasm, type LibarchiveWasm } from 'libarchive-wasm';
import wasmUrl from 'libarchive-wasm/dist/libarchive.wasm?url';

export type LibarchiveLoader = () => Promise<LibarchiveWasm>;

/** Browser/worker loader: the WASM binary is a separate hashed asset, fetched only on first RAR/7z open. */
export const loadLibarchive: LibarchiveLoader = () => libarchiveWasm({ locateFile: () => wasmUrl });
