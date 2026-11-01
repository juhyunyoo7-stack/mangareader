import type { Book } from '../core/types.ts';
import { FULL_PAGE, type Rect } from '../core/trim.ts';
import { RpcClient, RpcError } from '../workers/rpc.ts';

export interface DecodedPage {
  bitmap: ImageBitmap;
  srcW: number;
  srcH: number;
}

export class DecodeFailed extends Error {}

/** Per-page layout analysis (fractions of the page): margin box and unordered panels. */
export interface PageAnalysis {
  trim: Rect;
  panels: Rect[];
  /** two-page spread: panels belong to the left/right half (see readingOrder) */
  spread: boolean;
}

/** Typed main-thread handle on the decode worker for one open book. */
export class DecodeClient {
  private rpc: RpcClient;
  private closed = false;
  /** number of requests in flight (debug overlay) */
  inflight = 0;

  constructor(private readonly book: Book) {
    this.rpc = new RpcClient(
      new Worker(new URL('../workers/decode.worker.ts', import.meta.url), {
        type: 'module',
        name: 'decode',
      }),
    );
  }

  async open(source: { file?: File; opfsPath?: string[] }): Promise<void> {
    await this.rpc.call('open', {
      bookId: this.book.id,
      forceWasmImages: new URLSearchParams(location.search).get('wasmimg') === '1',
      ...source,
    });
  }

  private async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
    this.inflight++;
    try {
      return await this.rpc.call<T>(method, { bookId: this.book.id, ...args });
    } catch (e) {
      if (e instanceof RpcError && e.code === 'decode') throw new DecodeFailed(e.message);
      throw e;
    } finally {
      this.inflight--;
    }
  }

  decodePage(page: number, wantW: number, wantH: number): Promise<DecodedPage> {
    return this.call('decodePage', { entry: this.book.pages[page]!.entry, wantW, wantH });
  }

  decodeTile(
    page: number,
    r: { sx: number; sy: number; sw: number; sh: number; scale: number },
  ): Promise<DecodedPage> {
    return this.call('decodeTile', { entry: this.book.pages[page]!.entry, ...r });
  }

  private analyses = new Map<number, Promise<PageAnalysis>>();

  /** Margin box and panels of a page; cached for the life of the reader, failures count as 'whole page'. */
  analyze(page: number): Promise<PageAnalysis> {
    let p = this.analyses.get(page);
    if (!p) {
      p = this.call<PageAnalysis>('analyzePage', { entry: this.book.pages[page]!.entry }).catch(
        () => ({ trim: FULL_PAGE, panels: [FULL_PAGE], spread: false }),
      );
      this.analyses.set(page, p);
    }
    return p;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.rpc.call('close', { bookId: this.book.id }).finally(() => this.rpc.terminate());
  }
}
