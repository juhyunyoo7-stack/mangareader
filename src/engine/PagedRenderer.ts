import { layoutSpreads, pageToSpread, resolveLayout, visualOrder } from '../core/spread.ts';
import type { PageInfo, Spread } from '../core/types.ts';
import { tilesForRegion, type Rect } from '../core/tiling.ts';
import { readingOrder } from '../core/panels.ts';
import { FULL_PAGE, unionRect, type Rect as FRect } from '../core/trim.ts';
import { filterCss } from './filters.ts';
import { DecodeFailed } from './DecodeClient.ts';
import { Gestures } from './Gestures.ts';
import { classifySwipe, zoneAction } from './controls.ts';
import type { Renderer, RendererServices } from './types.ts';
import {
  DOUBLE_TAP_ZOOM,
  canPan,
  clampPan,
  clampZoom,
  fitScale,
  initialView,
  isZoomed,
  pinchZoom,
  visibleRect,
  zoomAround,
  type Point,
  type Size,
  type View,
} from './Viewport.ts';

const GUIDED_PAD = 0.04;

interface Slot {
  page: number;
  canvas: HTMLCanvasElement;
  left: number;
  width: number;
  height: number;
  cssPerSrc: number;
  /** displayed (cropped) source size and the crop origin in full-page source px */
  srcW: number;
  srcH: number;
  ox: number;
  oy: number;
  bmpW: number;
}

interface Tile {
  canvas: HTMLCanvasElement;
  bytes: number;
}

interface Live {
  wrap: HTMLDivElement;
  layer: HTMLDivElement;
  slots: Slot[];
  base: Size;
  spreadIndex: number;
  keys: string[];
  tiles: Map<string, Tile>;
  pending: Set<string>;
}

interface PageLayout {
  page: number;
  info: PageInfo;
  left: number;
  width: number;
  height: number;
  cssPerSrc: number;
  wantW: number;
  wantH: number;
  crop: FRect;
}

const BUCKET = 128;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class PagedRenderer implements Renderer {
  private stage: HTMLDivElement;
  private spreads: Spread[] = [];
  private spreadIndex = 0;
  private target = 0;
  private token = 0;
  private live: Live | null = null;
  private leaving: Live[] = [];
  private view: View = { zoom: 1, tx: 0, ty: 0 };
  private gestures: Gestures;
  private inflight = new Map<string, Promise<ImageBitmap | null>>();
  private detailTimer: number | null = null;
  private prefetchToken = 0;
  private destroyed = false;
  private resolvedLayout: 'single' | 'double' = 'single';
  private dragStartView: View | null = null;
  private wheelAccum = 0;
  private wheelLock = 0;
  private pinching = false;
  /** margin boxes (fractions) per page, filled when auto-trim is on */
  private trims = new Map<number, FRect>();
  /** guided view: ordered panels of the shown page (empty = whole page), current index */
  private panels: FRect[] = [];
  private panelIdx = 0;
  private guidedReady = true;

  constructor(private readonly s: RendererServices) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.stage.tabIndex = -1;
    this.stage.dataset.mode = 'paged';
    s.host.appendChild(this.stage);
    this.gestures = new Gestures(this.stage, {
      onTap: (p) => this.onTap(p),
      deferTap: (p) => this.deferTap(p),
      onDoubleTap: (p) => this.onDoubleTap(p),
      onLongPress: (p) => this.onLongPress(p),
      onDrag: (dx, dy, _p, type) => this.onDrag(dx, dy, type),
      onDragEnd: (t) => this.onDragEnd(t),
      onPinch: (r, c, dx, dy) => this.onPinch(r, c, dx, dy),
      onPinchEnd: () => this.onPinchEnd(),
      onWheel: (e) => this.onWheel(e),
    });
  }

  // ---- geometry ----------------------------------------------------------------------------
  private get viewSize(): Size {
    return { w: this.stage.clientWidth, h: this.stage.clientHeight };
  }
  private dpr(): number {
    return window.devicePixelRatio || 1;
  }

  private rebuildSpreads(keepPage: number): void {
    const cfg = this.s.getConfig();
    const vs = this.viewSize;
    const resolved = resolveLayout(cfg.layout, vs.w, vs.h);
    this.resolvedLayout = resolved === 'double' && !cfg.guided ? 'double' : 'single';
    this.spreads = layoutSpreads(this.s.book.pages, {
      coverOffset: cfg.coverOffset,
      pairShift: cfg.pairShift,
      overrides: cfg.overrides,
      layout: this.resolvedLayout,
    });
    this.spreadIndex = this.target = pageToSpread(this.spreads, keepPage);
  }

  private layoutFor(spread: Spread): { pages: PageLayout[]; base: Size } {
    const cfg = this.s.getConfig();
    const order = visualOrder(spread, cfg.direction === 'vertical' ? 'ltr' : cfg.direction);
    const infos = order.map((i) => this.s.book.pages[i]!);
    const crop = this.cropFor(spread.pages);
    const cw = infos.map((p) => (p.w || 1) * crop.w);
    const ch = infos.map((p) => (p.h || 1) * crop.h);
    const hSrc = Math.max(...ch);
    const widths = cw.map((w, i) => (w * hSrc) / ch[i]!);
    const natural: Size = { w: widths.reduce((a, b) => a + b, 0), h: hSrc };
    const dpr = this.dpr();
    const sc = fitScale(cfg.fit, natural, this.viewSize, dpr);
    const base: Size = { w: natural.w * sc, h: natural.h * sc };
    let left = 0;
    const pages = infos.map((info, i) => {
      const width = widths[i]! * sc;
      const height = hSrc * sc;
      const pl: PageLayout = {
        page: info.index,
        info,
        left,
        width,
        height,
        cssPerSrc: (sc * hSrc) / ch[i]!,
        wantW: Math.ceil(width * dpr),
        wantH: Math.max(BUCKET, Math.ceil((height * dpr) / crop.h / BUCKET) * BUCKET),
        crop,
      };
      left += width;
      return pl;
    });
    return { pages, base };
  }

  private cropFor(pages: number[]): FRect {
    if (!this.s.getConfig().autoTrim) return FULL_PAGE;
    let c: FRect | null = null;
    for (const p of pages) {
      const t = this.trims.get(p);
      if (!t) return FULL_PAGE; // analysis not ready: show uncropped rather than mismatched crops
      c = c ? unionRect(c, t) : t;
    }
    return c ?? FULL_PAGE;
  }

  private async loadTrims(pages: number[]): Promise<void> {
    await Promise.all(
      pages
        .filter((p) => !this.trims.has(p))
        .map(async (p) => {
          this.trims.set(p, (await this.s.decoder.analyze(p)).trim);
        }),
    );
  }

  private keyFor(pl: PageLayout): string {
    return `${this.s.book.id}:${pl.page}:${pl.wantH}`;
  }

  // ---- decoding ----------------------------------------------------------------------------
  private getBitmap(pl: PageLayout): Promise<ImageBitmap | null> {
    const key = this.keyFor(pl);
    const hit = this.s.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running;
    const wantW = Math.max(pl.wantW, Math.ceil((pl.wantH * (pl.info.w || 1)) / (pl.info.h || 1)));
    const p = this.s.decoder
      .decodePage(pl.page, wantW, pl.wantH)
      .then((d) => {
        if (this.destroyed) {
          d.bitmap.close();
          return null;
        }
        this.s.cache.set(key, d.bitmap);
        return d.bitmap;
      })
      .catch((e) => {
        if (e instanceof DecodeFailed) return null;
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  // ---- lifecycle ---------------------------------------------------------------------------
  private applyFilters(): void {
    this.stage.style.filter = filterCss(this.s.getConfig().filters);
  }

  async start(page: number): Promise<void> {
    this.applyFilters();
    this.rebuildSpreads(page);
    await this.show(this.target, 0);
  }

  private async show(index: number, dir: number): Promise<void> {
    if (this.destroyed || this.spreads.length === 0) return;
    const token = ++this.token;
    const spread = this.spreads[index]!;
    if (this.s.getConfig().autoTrim) {
      await this.loadTrims(spread.pages);
      if (token !== this.token || this.destroyed) return;
    }
    const { pages, base } = this.layoutFor(spread);
    // pin before decoding: an incoming bitmap must never be evicted before it is drawn
    this.s.cache.pin([...pages.map((pl) => this.keyFor(pl)), ...(this.live?.keys ?? [])]);
    const bitmaps = await Promise.all(pages.map((pl) => this.getBitmap(pl)));
    if (token !== this.token || this.destroyed) return;
    const old = this.live;
    const live = this.buildLive(index, pages, base, bitmaps);
    this.view = initialView(this.viewSize, base, this.s.getConfig().direction);
    this.applyView(live, false);
    this.s.cache.pin(live.keys);
    this.stage.appendChild(live.wrap);
    this.live = live;
    this.spreadIndex = index;
    if (old) this.retire(old, dir);
    this.animateIn(live, dir, !!old);
    this.updateExternal();
    this.publishState();
    this.s.events.onPage(Math.min(...spread.pages));
    this.s.events.onState();
    void this.prefetch(index);
    void this.enterGuided(spread.pages[0]!, dir, token);
  }

  // ---- guided view -------------------------------------------------------------------------
  private async enterGuided(page: number, dir: number, token: number): Promise<void> {
    this.panels = [];
    this.panelIdx = 0;
    this.stage.dataset.panels = '0';
    delete this.stage.dataset.panel;
    delete this.stage.dataset.panelRect;
    if (!this.s.getConfig().guided) {
      this.guidedReady = true;
      delete this.stage.dataset.guided;
      return;
    }
    this.guidedReady = false;
    this.stage.dataset.guided = 'pending';
    const a = await this.s.decoder.analyze(page);
    if (token !== this.token || this.destroyed) return;
    const rtl = this.s.getConfig().direction === 'rtl';
    this.panels = a.panels.length > 1 ? readingOrder(a.panels, rtl, a.spread) : [];
    this.guidedReady = true;
    this.stage.dataset.guided = 'ready';
    this.stage.dataset.panels = String(this.panels.length);
    if (this.panels.length > 0) this.focusPanel(dir < 0 ? this.panels.length - 1 : 0, false);
  }

  /** Camera to panel `i`: zoom so the padded panel fills the view, centred on it. */
  private focusPanel(i: number, animate: boolean): void {
    const live = this.live;
    const sl = live?.slots[0];
    const p = this.panels[i];
    if (!live || !sl || !p) return;
    this.panelIdx = i;
    const crop = this.cropFor([sl.page]);
    // panel (full-page fractions) -> fractions of the displayed (cropped) page
    const fx0 = Math.max(0, (p.x - crop.x) / crop.w);
    const fy0 = Math.max(0, (p.y - crop.y) / crop.h);
    const fx1 = Math.min(1, (p.x + p.w - crop.x) / crop.w);
    const fy1 = Math.min(1, (p.y + p.h - crop.y) / crop.h);
    const padX = (fx1 - fx0) * GUIDED_PAD;
    const padY = (fy1 - fy0) * GUIDED_PAD;
    const x0 = sl.left + Math.max(0, fx0 - padX) * sl.width;
    const x1 = sl.left + Math.min(1, fx1 + padX) * sl.width;
    const y0 = Math.max(0, fy0 - padY) * sl.height;
    const y1 = Math.min(1, fy1 + padY) * sl.height;
    const vs = this.viewSize;
    const zoom = clampZoom(Math.min(vs.w / (x1 - x0), vs.h / (y1 - y0)));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    this.view = clampPan(vs, live.base, {
      zoom,
      tx: vs.w / 2 - cx * zoom,
      ty: vs.h / 2 - cy * zoom,
    });
    this.applyView(live, animate);
    this.stage.dataset.panel = String(i);
    this.stage.dataset.panelRect = [p.x, p.y, p.w, p.h].map((v) => v.toFixed(3)).join(',');
    this.s.events.onState();
  }

  private buildLive(
    index: number,
    pages: PageLayout[],
    base: Size,
    bitmaps: (ImageBitmap | null)[],
  ): Live {
    const wrap = document.createElement('div');
    wrap.className = 'spread';
    wrap.dataset.state = 'current';
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.style.width = `${base.w}px`;
    layer.style.height = `${base.h}px`;
    wrap.appendChild(layer);
    const slots: Slot[] = pages.map((pl, i) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'page';
      canvas.dataset.page = String(pl.page);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${pl.page + 1}`);
      canvas.style.left = `${pl.left}px`;
      canvas.style.width = `${pl.width}px`;
      canvas.style.height = `${pl.height}px`;
      const bmp = bitmaps[i];
      if (bmp) {
        const c = pl.crop;
        const sx = Math.round(bmp.width * c.x);
        const sy = Math.round(bmp.height * c.y);
        canvas.width = Math.max(1, Math.min(bmp.width - sx, Math.round(bmp.width * c.w)));
        canvas.height = Math.max(1, Math.min(bmp.height - sy, Math.round(bmp.height * c.h)));
        canvas
          .getContext('2d')!
          .drawImage(bmp, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      } else {
        this.drawPlaceholder(canvas, pl);
      }
      layer.appendChild(canvas);
      return {
        page: pl.page,
        canvas,
        left: pl.left,
        width: pl.width,
        height: pl.height,
        cssPerSrc: pl.cssPerSrc,
        srcW: (pl.info.w || 1) * pl.crop.w,
        srcH: (pl.info.h || 1) * pl.crop.h,
        ox: (pl.info.w || 1) * pl.crop.x,
        oy: (pl.info.h || 1) * pl.crop.y,
        bmpW: canvas.width,
      };
    });
    return {
      wrap,
      layer,
      slots,
      base,
      spreadIndex: index,
      keys: pages.map((pl) => this.keyFor(pl)),
      tiles: new Map(),
      pending: new Set(),
    };
  }

  private drawPlaceholder(canvas: HTMLCanvasElement, pl: PageLayout): void {
    canvas.width = Math.max(64, Math.min(800, Math.round(pl.width * 2)));
    canvas.height = Math.max(64, Math.min(1200, Math.round(pl.height * 2)));
    canvas.dataset.error = '1';
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ccc';
    ctx.font = `${Math.round(canvas.width / 18)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Cannot decode this page', canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#888';
    const name = pl.info.entry.split('/').pop() ?? '';
    ctx.fillText(name.slice(0, 40), canvas.width / 2, canvas.height / 2 + canvas.width / 14);
  }

  private retire(old: Live, dir: number): void {
    old.wrap.dataset.state = 'leaving';
    old.wrap.setAttribute('aria-hidden', 'true');
    this.dropTiles(old);
    const transition = this.s.getConfig().ui.transition;
    if (transition === 'none' || reducedMotion() || !old.wrap.animate) {
      old.wrap.remove();
      this.updateExternal();
      return;
    }
    // never let fast flipping pile up animating layers: only the most recent one may linger
    for (const l of this.leaving) {
      l.wrap.getAnimations().forEach((a) => a.cancel());
      l.wrap.remove();
    }
    this.leaving = [old];
    const fwd = dir >= 0 ? 1 : -1;
    const rtl = this.s.getConfig().direction === 'rtl';
    const sign = (rtl ? -1 : 1) * fwd;
    const frames =
      transition === 'fade'
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${-sign * 8}%)` },
          ];
    const a = old.wrap.animate(frames, { duration: 160, easing: 'ease-out', fill: 'forwards' });
    const done = () => {
      old.wrap.remove();
      this.leaving = this.leaving.filter((l) => l !== old);
      this.updateExternal();
    };
    a.onfinish = done;
    a.oncancel = done;
  }

  private animateIn(live: Live, dir: number, hadOld: boolean): void {
    const transition = this.s.getConfig().ui.transition;
    if (!hadOld || transition === 'none' || reducedMotion() || !live.wrap.animate) return;
    const fwd = dir >= 0 ? 1 : -1;
    const rtl = this.s.getConfig().direction === 'rtl';
    const sign = (rtl ? -1 : 1) * fwd;
    const frames =
      transition === 'fade'
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateX(${sign * 8}%)` },
            { opacity: 1, transform: 'translateX(0)' },
          ];
    live.wrap.animate(frames, { duration: 160, easing: 'ease-out' });
  }

  // ---- prefetch ----------------------------------------------------------------------------
  private async prefetch(index: number): Promise<void> {
    const my = ++this.prefetchToken;
    const ahead = this.spreadsAhead();
    const order = [
      index + 1,
      index - 1,
      ...Array.from({ length: ahead - 1 }, (_, i) => index + 2 + i),
    ];
    for (const i of order) {
      if (my !== this.prefetchToken || this.destroyed) return;
      const sp = this.spreads[i];
      if (!sp) continue;
      if (this.s.getConfig().autoTrim) await this.loadTrims(sp.pages).catch(() => undefined);
      const { pages } = this.layoutFor(sp);
      for (const pl of pages) {
        if (my !== this.prefetchToken || this.destroyed) return;
        try {
          await this.getBitmap(pl);
        } catch {
          /* prefetch failures are silent */
        }
      }
    }
  }

  private spreadsAhead(): number {
    return (window as unknown as { __mrPrefetch?: number }).__mrPrefetch ?? 2;
  }

  // ---- navigation --------------------------------------------------------------------------
  next(): boolean {
    if (this.s.getConfig().guided) {
      if (!this.guidedReady) return true; // panels are still being analysed
      if (this.panelIdx + 1 < this.panels.length) {
        this.focusPanel(this.panelIdx + 1, true);
        return true;
      }
    }
    if (this.target + 1 >= this.spreads.length) {
      this.s.events.onEdge('end');
      return false;
    }
    this.target++;
    void this.show(this.target, 1);
    return true;
  }
  prev(): boolean {
    if (this.s.getConfig().guided) {
      if (!this.guidedReady) return true;
      if (this.panelIdx > 0) {
        this.focusPanel(this.panelIdx - 1, true);
        return true;
      }
    }
    if (this.target <= 0) {
      this.s.events.onEdge('start');
      return false;
    }
    this.target--;
    void this.show(this.target, -1);
    return true;
  }
  goto(page: number): void {
    const idx = pageToSpread(this.spreads, Math.max(0, Math.min(this.s.book.pageCount - 1, page)));
    const dir = idx >= this.target ? 1 : -1;
    this.target = idx;
    void this.show(idx, dir);
  }
  currentPage(): number {
    const sp = this.spreads[this.spreadIndex];
    return sp ? Math.min(...sp.pages) : 0;
  }
  pagesShown(): number[] {
    return this.spreads[this.spreadIndex]?.pages ?? [];
  }
  canvasCount(): number {
    return this.stage.querySelectorAll('canvas').length;
  }
  zoom(): number {
    return this.view.zoom;
  }
  pageOffset(): number | undefined {
    return undefined;
  }

  configChanged(): void {
    this.applyFilters();
    const keep = this.currentPage();
    this.rebuildSpreads(keep);
    void this.show(this.target, 0);
  }

  resize(): void {
    if (this.destroyed || !this.live) return;
    const keep = this.currentPage();
    this.rebuildSpreads(keep);
    void this.show(this.target, 0);
  }

  // ---- view/zoom ---------------------------------------------------------------------------
  private applyView(live: Live | null = this.live, animate = false): void {
    if (!live) return;
    const v = this.view;
    live.layer.style.transition =
      animate && !reducedMotion()
        ? `transform ${this.panels.length ? 250 : 150}ms ease-out`
        : 'none';
    live.layer.style.transform = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.zoom})`;
    this.stage.dataset.zoom = v.zoom.toFixed(2);
    this.scheduleDetail();
  }

  zoomBy(factor: number, at?: Point): void {
    if (!this.live) return;
    const vs = this.viewSize;
    const p = at ?? { x: vs.w / 2, y: vs.h / 2 };
    this.view = zoomAround(vs, this.live.base, this.view, p, this.view.zoom * factor);
    this.applyView(this.live, true);
    this.s.events.onState();
  }
  zoomReset(): void {
    if (!this.live) return;
    this.view = initialView(this.viewSize, this.live.base, this.s.getConfig().direction);
    this.applyView(this.live, true);
    this.s.events.onState();
  }
  panBy(dx: number, dy: number): void {
    if (!this.live) return;
    this.view = clampPan(this.viewSize, this.live.base, {
      ...this.view,
      tx: this.view.tx + dx,
      ty: this.view.ty + dy,
    });
    this.applyView(this.live, false);
  }

  // ---- input handlers ----------------------------------------------------------------------
  private deferTap(p: Point): boolean {
    const cfg = this.s.getConfig();
    if (cfg.guided && this.panels.length > 0) return false;
    if (!cfg.ui.doubleTapZoom) return false;
    if (isZoomed(this.view)) return true;
    const vs = this.viewSize;
    return zoneAction(cfg.ui.zones, cfg.direction, p.x, p.y, vs.w, vs.h) === 'menu';
  }

  private onTap(p: Point): void {
    const cfg = this.s.getConfig();
    const vs = this.viewSize;
    // in guided view the camera is zoomed by design: taps keep stepping through panels
    if (isZoomed(this.view) && !(cfg.guided && this.panels.length > 0)) {
      this.s.events.onMenuToggle();
      return;
    }
    const a = zoneAction(cfg.ui.zones, cfg.direction, p.x, p.y, vs.w, vs.h);
    if (a === 'next') this.next();
    else if (a === 'prev') this.prev();
    else if (a === 'menu') this.s.events.onMenuToggle();
  }

  private onDoubleTap(p: Point): void {
    if (!this.live) return;
    if (isZoomed(this.view)) this.zoomReset();
    else this.zoomBy(DOUBLE_TAP_ZOOM, p);
  }

  private onLongPress(p: Point): void {
    if (!this.live) return;
    // find the page under the pointer in layer coordinates
    const lx = (p.x - this.view.tx) / this.view.zoom;
    let page = this.live.slots[0]?.page ?? 0;
    for (const sl of this.live.slots) if (lx >= sl.left && lx <= sl.left + sl.width) page = sl.page;
    this.s.events.onPageMenu(page, p);
  }

  private onDrag(dx: number, dy: number, type: string): void {
    if (!this.live) return;
    if (!this.dragStartView) this.dragStartView = { ...this.view };
    void type; // a drag pans whenever there is room, for any pointer type
    this.view = clampPan(this.viewSize, this.live.base, {
      ...this.view,
      tx: this.view.tx + dx,
      ty: this.view.ty + dy,
    });
    this.applyView(this.live, false);
  }

  private onDragEnd(t: {
    dx: number;
    dy: number;
    dt: number;
    pointerType: string;
    button: number;
  }): void {
    const start = this.dragStartView;
    this.dragStartView = null;
    if (!this.live || !start || t.button === 1) return;
    const cfg = this.s.getConfig();
    const sw = classifySwipe(t.dx, t.dy, t.dt, cfg.direction);
    if (!sw.action || t.pointerType === 'mouse') return;
    const vs = this.viewSize;
    const horizontal = cfg.direction !== 'vertical';
    const sign = (horizontal ? t.dx : t.dy) > 0 ? 1 : -1;
    // swipe only turns the page at fit zoom, or when the pan was already at that edge
    const canMove = canPan(vs, this.live.base, start, horizontal ? 'x' : 'y', sign as 1 | -1);
    if (canMove) return;
    if (sw.action === 'next') this.next();
    else this.prev();
  }

  private onPinch(ratio: number, center: Point, dx: number, dy: number): void {
    if (!this.live) return;
    this.pinching = true;
    const base = this.live.base;
    const vs = this.viewSize;
    const z = pinchZoom(this.view.zoom, 1, ratio);
    let v = zoomAround(vs, base, this.view, center, z);
    v = clampPan(vs, base, { ...v, tx: v.tx + dx, ty: v.ty + dy }, 30);
    this.view = v;
    this.applyView(this.live, false);
  }

  private onPinchEnd(): void {
    this.pinching = false;
    if (!this.live) return;
    this.view = clampPan(this.viewSize, this.live.base, this.view);
    if (this.view.zoom < 1.05)
      this.view = initialView(this.viewSize, this.live.base, this.s.getConfig().direction);
    this.applyView(this.live, true);
    this.s.events.onState();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.live) return;
    const r = this.stage.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey) {
      this.zoomBy(Math.exp(-e.deltaY * 0.01), p);
      return;
    }
    if (
      isZoomed(this.view) ||
      this.live.base.h > this.viewSize.h + 1 ||
      this.live.base.w > this.viewSize.w + 1
    ) {
      this.panBy(-e.deltaX, -e.deltaY);
      return;
    }
    if (!this.s.getConfig().ui.wheelTurnsPage) return;
    const now = performance.now();
    if (now < this.wheelLock) return;
    this.wheelAccum += e.deltaY || e.deltaX;
    if (Math.abs(this.wheelAccum) >= 40) {
      const forward = this.wheelAccum > 0;
      this.wheelAccum = 0;
      this.wheelLock = now + 220;
      if (forward) this.next();
      else this.prev();
    }
  }

  // ---- detail tiles (zoomed) ---------------------------------------------------------------
  private scheduleDetail(): void {
    if (this.detailTimer !== null) clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => {
      this.detailTimer = null;
      void this.renderDetail();
    }, 150);
  }

  private dropTiles(live: Live): void {
    for (const t of live.tiles.values()) {
      t.canvas.remove();
      t.canvas.width = 0; // release the backing store promptly
    }
    live.tiles.clear();
    live.pending.clear();
  }

  private async renderDetail(): Promise<void> {
    const live = this.live;
    if (!live || this.destroyed || this.pinching) return;
    if (this.view.zoom < 1.05) {
      this.dropTiles(live);
      this.updateExternal();
      this.publishState();
      return;
    }
    const vis = visibleRect(this.viewSize, this.view);
    const dpr = this.dpr();
    const wanted = new Set<string>();
    const jobs: Promise<void>[] = [];
    for (const sl of live.slots) {
      const slotRect: Rect = { x: sl.left, y: 0, w: sl.width, h: sl.height };
      const ix = Math.max(slotRect.x, vis.x);
      const iy = Math.max(slotRect.y, vis.y);
      const ix2 = Math.min(slotRect.x + slotRect.w, vis.x + vis.w);
      const iy2 = Math.min(slotRect.y + slotRect.h, vis.y + vis.h);
      if (ix2 <= ix || iy2 <= iy) continue;
      const rawNeed = sl.cssPerSrc * this.view.zoom * dpr;
      const need = Math.min(1, Math.ceil(rawNeed * 8) / 8);
      const baseScale = sl.bmpW / Math.max(1, sl.srcW);
      if (need <= baseScale * 1.1) continue; // base bitmap already sharp enough
      const outW = Math.max(1, Math.round(sl.srcW * need));
      const outH = Math.max(1, Math.round(sl.srcH * need));
      // visible region of the page in output pixels
      const region: Rect = {
        x: ((ix - sl.left) / sl.cssPerSrc) * need,
        y: (iy / sl.cssPerSrc) * need,
        w: ((ix2 - ix) / sl.cssPerSrc) * need,
        h: ((iy2 - iy) / sl.cssPerSrc) * need,
      };
      for (const t of tilesForRegion(outW, outH, region)) {
        const key = `${sl.page}:${need}:${t.x}:${t.y}`;
        wanted.add(key);
        if (live.tiles.has(key) || live.pending.has(key)) continue;
        live.pending.add(key);
        jobs.push(this.loadTile(live, sl, key, t, need));
      }
    }
    for (const [k, t] of live.tiles) {
      if (!wanted.has(k)) {
        t.canvas.remove();
        t.canvas.width = 0;
        live.tiles.delete(k);
      }
    }
    await Promise.all(jobs);
    this.updateExternal();
    this.publishState();
  }

  private async loadTile(live: Live, sl: Slot, key: string, t: Rect, need: number): Promise<void> {
    try {
      const d = await this.s.decoder.decodeTile(sl.page, {
        sx: t.x / need + sl.ox,
        sy: t.y / need + sl.oy,
        sw: t.w / need,
        sh: t.h / need,
        scale: need,
      });
      if (this.destroyed || this.live !== live) {
        d.bitmap.close();
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'tile';
      canvas.dataset.page = String(sl.page);
      canvas.dataset.tile = `${t.x},${t.y}`;
      canvas.width = d.bitmap.width;
      canvas.height = d.bitmap.height;
      canvas.getContext('2d')!.drawImage(d.bitmap, 0, 0);
      const bytes = d.bitmap.width * d.bitmap.height * 4;
      d.bitmap.close();
      canvas.style.left = `${sl.left + (t.x / need) * sl.cssPerSrc}px`;
      canvas.style.top = `${(t.y / need) * sl.cssPerSrc}px`;
      canvas.style.width = `${(t.w / need) * sl.cssPerSrc}px`;
      canvas.style.height = `${(t.h / need) * sl.cssPerSrc}px`;
      live.layer.appendChild(canvas);
      live.tiles.set(key, { canvas, bytes });
    } catch {
      /* a failed tile just leaves the base bitmap visible */
    } finally {
      live.pending.delete(key);
    }
  }

  // ---- accounting / debug ------------------------------------------------------------------
  private updateExternal(): void {
    let bytes = 0;
    const count = (l: Live | null) => {
      if (!l) return;
      for (const s of l.slots) bytes += s.canvas.width * s.canvas.height * 4;
      for (const t of l.tiles.values()) bytes += t.bytes;
    };
    count(this.live);
    this.leaving.forEach(count);
    this.s.cache.setExternal(bytes);
  }

  private publishState(): void {
    const sp = this.spreads[this.spreadIndex];
    if (!sp) return;
    this.stage.dataset.page = String(Math.min(...sp.pages));
    this.stage.dataset.pages = sp.pages.join(',');
    this.stage.dataset.spread = String(this.spreadIndex);
    this.stage.dataset.layout = this.resolvedLayout;
    this.stage.dataset.tiles = String(this.live?.tiles.size ?? 0);
    this.stage.dataset.ready = '1';
  }

  /** Test/debug helper: sizes of every canvas currently in the DOM. */
  debugCanvases(): { w: number; h: number; tile: boolean }[] {
    return [...this.stage.querySelectorAll('canvas')].map((c) => ({
      w: c.width,
      h: c.height,
      tile: c.classList.contains('tile'),
    }));
  }

  visibilityHidden(): void {
    if (this.live) this.dropTiles(this.live);
    this.s.cache.dropUnpinned();
    this.updateExternal();
  }

  destroy(): void {
    this.destroyed = true;
    this.token++;
    this.prefetchToken++;
    if (this.detailTimer !== null) clearTimeout(this.detailTimer);
    this.gestures.destroy();
    for (const l of [this.live, ...this.leaving]) {
      if (!l) continue;
      this.dropTiles(l);
      for (const s of l.slots) s.canvas.width = 0;
    }
    this.stage.remove();
    this.live = null;
    this.leaving = [];
    this.s.cache.clear();
    this.s.cache.setExternal(0);
  }
}
