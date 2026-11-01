import { PageCache } from '../../engine/PageCache.ts';
import type { DecodeClient } from '../../engine/DecodeClient.ts';

export const THUMB_W = 72;
export const THUMB_H = 104;

/** Small decoded-thumbnail cache + serial-ish loader for the slider preview and thumbnail strip. */
export class ThumbLoader {
  private cache = new PageCache(12 * 1024 * 1024);
  private inflight = new Map<number, Promise<ImageBitmap | null>>();
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly decoder: DecodeClient,
    private readonly bookId: string,
  ) {}

  private async slot(): Promise<void> {
    if (this.active < 2) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
  }
  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }

  async get(page: number): Promise<ImageBitmap | null> {
    const key = `${this.bookId}:${page}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const run = this.inflight.get(page);
    if (run) return run;
    const p = (async () => {
      await this.slot();
      try {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const d = await this.decoder.decodePage(page, THUMB_W * dpr, THUMB_H * dpr);
        this.cache.set(key, d.bitmap);
        return d.bitmap;
      } catch {
        return null;
      } finally {
        this.release();
        this.inflight.delete(page);
      }
    })();
    this.inflight.set(page, p);
    return p;
  }

  async draw(page: number, canvas: HTMLCanvasElement): Promise<void> {
    const bmp = await this.get(page);
    if (!bmp || !canvas.isConnected) return;
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  }

  dispose(): void {
    this.cache.clear();
  }
}
