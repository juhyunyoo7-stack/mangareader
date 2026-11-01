import { filterCss } from './filters.ts';
import { TILE_SIZE } from '../core/tiling.ts';
import { zoneAction } from './controls.ts';
import type { Renderer, RendererServices } from './types.ts';
import type { Point } from './Viewport.ts';

interface Strip {
  canvas: HTMLCanvasElement;
  bytes: number;
}

const MAX_CONTENT_WIDTH = 1000;
const ABOVE = 1.5; // viewport heights decoded above the viewport
const BELOW = 2.5; // and below

/**
 * Virtualised continuous vertical scroll (DESIGN 7.4). Slot geometry comes from header-probed page
 * dimensions so layout is stable before any pixel is decoded. Pages are rendered as strips of at
 * most 2048 device px so tall pages stay under the canvas cap, and only strips near the viewport
 * hold a canvas.
 */
export class WebtoonRenderer implements Renderer {
  private stage: HTMLDivElement;
  private spacer: HTMLDivElement;
  private tops: number[] = [];
  private heights: number[] = [];
  private total = 0;
  private cw = 0;
  private left = 0;
  private strips = new Map<string, Strip>();
  private pending = new Set<string>();
  private raf = 0;
  private settleTimer: number | null = null;
  private destroyed = false;
  private ready = false;
  private onScroll = () => this.schedule();
  private onClick = (e: MouseEvent) => this.click(e);

  constructor(private readonly s: RendererServices) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage webtoon';
    this.stage.dataset.mode = 'webtoon';
    this.stage.tabIndex = -1;
    this.spacer = document.createElement('div');
    this.spacer.className = 'spacer';
    this.stage.appendChild(this.spacer);
    this.stage.style.filter = filterCss(s.getConfig().filters);
    s.host.appendChild(this.stage);
    this.stage.addEventListener('scroll', this.onScroll, { passive: true });
    this.stage.addEventListener('click', this.onClick);
  }

  private dpr(): number {
    return window.devicePixelRatio || 1;
  }

  private computeLayout(): void {
    const vw = this.stage.clientWidth;
    this.cw = Math.min(vw, MAX_CONTENT_WIDTH);
    this.left = (vw - this.cw) / 2;
    const gap = this.s.getConfig().ui.webtoonGap;
    let y = 0;
    this.tops = [];
    this.heights = [];
    for (const p of this.s.book.pages) {
      const h = ((p.h || 1) * this.cw) / (p.w || 1);
      this.tops.push(y);
      this.heights.push(h);
      y += h + gap;
    }
    this.total = Math.max(0, y - gap);
    this.spacer.style.height = `${this.total}px`;
  }

  /** index of the page whose slot contains scroll position y */
  private pageAt(y: number): number {
    let lo = 0;
    let hi = this.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid]! <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  async start(page: number, offset = 0): Promise<void> {
    this.computeLayout();
    this.scrollToPage(page, offset);
    this.ready = true;
    this.update();
  }

  private scrollToPage(page: number, offset = 0): void {
    const i = Math.max(0, Math.min(this.tops.length - 1, page));
    this.stage.scrollTop = this.tops[i]! + offset * this.heights[i]!;
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.update();
    });
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settled(), 160);
  }

  private settled(): void {
    this.settleTimer = null;
    const page = this.currentPage();
    this.s.events.onPage(page, this.pageOffset());
    this.s.events.onState();
  }

  currentPage(): number {
    if (this.tops.length === 0) return 0;
    return this.pageAt(this.stage.scrollTop + 1);
  }
  pagesShown(): number[] {
    return [this.currentPage()];
  }
  pageOffset(): number | undefined {
    const i = this.currentPage();
    const h = this.heights[i] ?? 1;
    return Math.max(0, Math.min(1, (this.stage.scrollTop - (this.tops[i] ?? 0)) / h));
  }

  /** Decide which strips need canvases, create missing ones, drop the rest. */
  private update(): void {
    if (this.destroyed || !this.ready) return;
    const vh = this.stage.clientHeight;
    const st = this.stage.scrollTop;
    const winTop = st - ABOVE * vh;
    const winBot = st + vh + BELOW * vh;
    const dpr = this.dpr();
    const wanted = new Set<string>();
    const first = this.pageAt(Math.max(0, winTop));
    for (let i = first; i < this.tops.length; i++) {
      const top = this.tops[i]!;
      if (top > winBot) break;
      const pg = this.s.book.pages[i]!;
      const srcW = pg.w || 1;
      const srcH = pg.h || 1;
      const cssPerSrc = this.cw / srcW;
      const ds = Math.min(1, (this.cw * dpr) / srcW);
      const srcStripH = Math.max(1, Math.floor(TILE_SIZE / ds));
      const count = Math.ceil(srcH / srcStripH);
      for (let k = 0; k < count; k++) {
        const y0 = k * srcStripH;
        const h = Math.min(srcStripH, srcH - y0);
        const sTop = top + y0 * cssPerSrc;
        const sBot = sTop + h * cssPerSrc;
        if (sBot < winTop || sTop > winBot) continue;
        const key = `${i}:${k}:${Math.round(ds * 100)}`;
        wanted.add(key);
        if (this.strips.has(key) || this.pending.has(key)) continue;
        this.pending.add(key);
        void this.loadStrip(key, i, y0, h, srcW, ds, cssPerSrc, top);
      }
    }
    for (const [k, v] of this.strips) {
      if (!wanted.has(k)) {
        v.canvas.remove();
        v.canvas.width = 0;
        this.strips.delete(k);
      }
    }
    this.account();
    this.stage.dataset.page = String(this.currentPage());
    this.stage.dataset.pages = String(this.currentPage());
    this.stage.dataset.ready = '1';
    this.stage.dataset.strips = String(this.strips.size);
  }

  private async loadStrip(
    key: string,
    page: number,
    y0: number,
    h: number,
    srcW: number,
    ds: number,
    cssPerSrc: number,
    top: number,
  ): Promise<void> {
    try {
      const d = await this.s.decoder.decodeTile(page, {
        sx: 0,
        sy: y0,
        sw: srcW,
        sh: h,
        scale: ds,
      });
      if (this.destroyed || !this.isStillWanted(page)) {
        d.bitmap.close();
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'strip';
      canvas.dataset.page = String(page);
      canvas.dataset.strip = key;
      canvas.width = d.bitmap.width;
      canvas.height = d.bitmap.height;
      canvas.getContext('2d')!.drawImage(d.bitmap, 0, 0);
      const bytes = d.bitmap.width * d.bitmap.height * 4;
      d.bitmap.close();
      canvas.style.left = `${this.left}px`;
      canvas.style.top = `${top + y0 * cssPerSrc}px`;
      canvas.style.width = `${this.cw}px`;
      canvas.style.height = `${h * cssPerSrc}px`;
      this.spacer.appendChild(canvas);
      this.strips.set(key, { canvas, bytes });
      this.account();
      this.stage.dataset.strips = String(this.strips.size);
    } catch {
      /* leave the slot blank; a later scroll retries */
    } finally {
      this.pending.delete(key);
    }
  }

  /** a decoded strip is only worth drawing if its page is still near the viewport */
  private isStillWanted(page: number): boolean {
    const vh = this.stage.clientHeight;
    const st = this.stage.scrollTop;
    const top = this.tops[page]!;
    const bot = top + this.heights[page]!;
    return bot >= st - (ABOVE + 0.5) * vh && top <= st + vh + (BELOW + 0.5) * vh;
  }

  private account(): void {
    let b = 0;
    for (const v of this.strips.values()) b += v.bytes;
    this.s.cache.setExternal(b);
  }

  // ---- navigation --------------------------------------------------------------------------
  private scrollByScreen(sign: 1 | -1): boolean {
    const st = this.stage.scrollTop;
    const max = this.stage.scrollHeight - this.stage.clientHeight;
    if (sign > 0 && st >= max - 1) {
      this.s.events.onEdge('end');
      return false;
    }
    if (sign < 0 && st <= 0) {
      this.s.events.onEdge('start');
      return false;
    }
    this.stage.scrollBy({ top: sign * this.stage.clientHeight * 0.85, behavior: 'auto' });
    return true;
  }
  next(): boolean {
    return this.scrollByScreen(1);
  }
  prev(): boolean {
    return this.scrollByScreen(-1);
  }
  goto(page: number, offset = 0): void {
    this.scrollToPage(page, offset);
    this.schedule();
  }
  panBy(dx: number, dy: number): void {
    this.stage.scrollBy({ top: -dy, left: -dx });
  }
  zoom(): number {
    return 1;
  }
  zoomBy(): void {
    /* webtoon uses native scrolling; zoom is not supported */
  }
  zoomReset(): void {
    /* no-op */
  }
  canvasCount(): number {
    return this.strips.size;
  }
  debugCanvases() {
    return [...this.strips.values()].map((v) => ({
      w: v.canvas.width,
      h: v.canvas.height,
      tile: true,
    }));
  }

  private click(e: MouseEvent): void {
    const r = this.stage.getBoundingClientRect();
    const p: Point = { x: e.clientX - r.left, y: e.clientY - r.top };
    const cfg = this.s.getConfig();
    const a = zoneAction(cfg.ui.zones, 'vertical', p.x, p.y, r.width, r.height);
    if (a === 'next') this.next();
    else if (a === 'prev') this.prev();
    else if (a === 'menu') this.s.events.onMenuToggle();
  }

  configChanged(): void {
    this.stage.style.filter = filterCss(this.s.getConfig().filters);
    this.resize();
  }

  resize(): void {
    if (!this.ready) return;
    const page = this.currentPage();
    const offset = this.pageOffset() ?? 0;
    this.computeLayout();
    for (const v of this.strips.values()) {
      v.canvas.remove();
      v.canvas.width = 0;
    }
    this.strips.clear();
    this.scrollToPage(page, offset);
    this.update();
  }

  visibilityHidden(): void {
    for (const v of this.strips.values()) {
      v.canvas.remove();
      v.canvas.width = 0;
    }
    this.strips.clear();
    this.account();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.stage.removeEventListener('scroll', this.onScroll);
    this.stage.removeEventListener('click', this.onClick);
    for (const v of this.strips.values()) v.canvas.width = 0;
    this.strips.clear();
    this.stage.remove();
    this.s.cache.setExternal(0);
  }

  /** Persist position right now (pagehide). */
  flush(): void {
    this.s.events.onPage(this.currentPage(), this.pageOffset());
  }
}
