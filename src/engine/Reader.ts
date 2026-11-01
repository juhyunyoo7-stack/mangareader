import type { Book } from '../core/types.ts';
import { currentBudget } from '../core/memoryBudget.ts';
import { DecodeClient } from './DecodeClient.ts';
import { PageCache } from './PageCache.ts';
import { PagedRenderer } from './PagedRenderer.ts';
import { WebtoonRenderer } from './WebtoonRenderer.ts';
import { keyCommand } from './controls.ts';
import type { ReaderConfig, ReaderEvents, Renderer, RendererServices } from './types.ts';
import type { Point } from './Viewport.ts';

export function isDebug(): boolean {
  return localStorage.getItem('mr.debug') === '1' || location.search.includes('debug=1');
}

export interface DebugSnapshot {
  page: number;
  pages: number[];
  zoom: number;
  mode: string;
  canvases: number;
  canvasSizes: { w: number; h: number; tile: boolean }[];
  cache: ReturnType<PageCache['stats']>;
}

/** Facade over the renderers: owns the decoder, cache and input; framework-free. */
export class Reader {
  private renderer: Renderer | null = null;
  private mode: 'paged' | 'webtoon';
  readonly cache: PageCache;
  readonly decoder: DecodeClient;
  private destroyed = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onVis = () => {
    if (document.visibilityState === 'hidden') this.renderer?.visibilityHidden();
  };
  private onHide = () => {
    this.renderer?.visibilityHidden();
    this.flush();
  };
  private ro: ResizeObserver;
  private resizeTimer: number | null = null;
  private lastSize = { w: 0, h: 0 };

  constructor(
    private readonly host: HTMLElement,
    private readonly book: Book,
    decoder: DecodeClient,
    private config: ReaderConfig,
    private readonly events: ReaderEvents,
  ) {
    this.decoder = decoder;
    const override = Number(localStorage.getItem('mr.budgetMB'));
    this.cache = new PageCache(override > 0 ? override * 1024 * 1024 : currentBudget().cacheBytes);
    this.mode = config.layout === 'webtoon' ? 'webtoon' : 'paged';
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('pagehide', this.onHide);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(host);
    if (isDebug()) {
      (window as unknown as { __mr: unknown }).__mr = this;
    }
  }

  private services(): RendererServices {
    return {
      book: this.book,
      decoder: this.decoder,
      cache: this.cache,
      host: this.host,
      events: this.events,
      getConfig: () => this.config,
    };
  }

  private make(mode: 'paged' | 'webtoon'): Renderer {
    return mode === 'webtoon'
      ? new WebtoonRenderer(this.services())
      : new PagedRenderer(this.services());
  }

  async start(page: number, offset?: number): Promise<void> {
    this.lastSize = { w: this.host.clientWidth, h: this.host.clientHeight };
    this.renderer = this.make(this.mode);
    await this.renderer.start(page, offset);
  }

  getConfig(): ReaderConfig {
    return this.config;
  }

  setConfig(patch: Partial<ReaderConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...patch };
    const mode = this.config.layout === 'webtoon' ? 'webtoon' : 'paged';
    if (!this.renderer) return;
    if (mode !== this.mode) {
      const page = this.renderer.currentPage();
      this.renderer.destroy();
      this.mode = mode;
      this.renderer = this.make(mode);
      void this.renderer.start(page);
      return;
    }
    this.renderer.configChanged();
  }

  next(): boolean {
    return this.renderer?.next() ?? false;
  }
  prev(): boolean {
    return this.renderer?.prev() ?? false;
  }
  goto(page: number, offset?: number): void {
    this.renderer?.goto(page, offset);
  }
  currentPage(): number {
    return this.renderer?.currentPage() ?? 0;
  }
  pagesShown(): number[] {
    return this.renderer?.pagesShown() ?? [];
  }
  zoom(): number {
    return this.renderer?.zoom() ?? 1;
  }
  zoomBy(f: number, at?: Point): void {
    this.renderer?.zoomBy(f, at);
  }
  zoomReset(): void {
    this.renderer?.zoomReset();
  }
  pageOffset(): number | undefined {
    return this.renderer?.pageOffset();
  }
  flush(): void {
    const r = this.renderer;
    if (!r) return;
    this.events.onPage(r.currentPage(), r.pageOffset());
  }

  private onResize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === this.lastSize.w && h === this.lastSize.h) return;
    this.lastSize = { w, h };
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.renderer?.resize(), 120);
  }

  private key(e: KeyboardEvent): void {
    if (this.destroyed || !this.renderer) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'SELECT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable)
    )
      return;
    if (document.querySelector('[role=dialog]') && e.key !== 'Escape') return;
    const cmd = keyCommand(
      e,
      this.config.direction,
      this.renderer.zoom() > 1.02 && !this.config.guided,
    );
    if (!cmd) return;
    e.preventDefault();
    switch (cmd) {
      case 'next':
        this.next();
        break;
      case 'prev':
        this.prev();
        break;
      case 'first':
        this.goto(0);
        break;
      case 'last':
        this.goto(this.book.pageCount - 1);
        break;
      case 'zoomIn':
        this.zoomBy(1.4);
        break;
      case 'zoomOut':
        this.zoomBy(1 / 1.4);
        break;
      case 'zoomReset':
        this.zoomReset();
        break;
      case 'panLeft':
        this.renderer.panBy(80, 0);
        break;
      case 'panRight':
        this.renderer.panBy(-80, 0);
        break;
      case 'panUp':
        this.renderer.panBy(0, 80);
        break;
      case 'panDown':
        this.renderer.panBy(0, -80);
        break;
      default:
        this.events.onCommand(cmd);
    }
  }

  debug(): DebugSnapshot {
    return {
      page: this.currentPage(),
      pages: this.pagesShown(),
      zoom: this.zoom(),
      mode: this.mode,
      canvases: this.renderer?.canvasCount() ?? 0,
      canvasSizes: this.renderer?.debugCanvases() ?? [],
      cache: this.cache.stats(),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('pagehide', this.onHide);
    this.ro.disconnect();
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.renderer?.destroy();
    this.renderer = null;
    this.cache.clear();
    this.decoder.close();
    const w = window as unknown as { __mr?: unknown };
    if (w.__mr === this) delete w.__mr;
  }
}
