import type {
  Book,
  Direction,
  FilterPrefs,
  FitMode,
  LayoutMode,
  PageOverride,
  UiSettings,
} from '../core/types.ts';
import type { PageCache } from './PageCache.ts';
import type { DecodeClient } from './DecodeClient.ts';
import type { Point } from './Viewport.ts';
import type { KeyCommand } from './controls.ts';

export interface ReaderConfig {
  direction: Direction;
  layout: LayoutMode;
  fit: FitMode;
  coverOffset: boolean;
  pairShift: 0 | 1;
  filters: FilterPrefs;
  autoTrim: boolean;
  guided: boolean;
  overrides: PageOverride[];
  ui: UiSettings;
}

export interface ReaderEvents {
  /** a page (lowest index shown) has settled on screen */
  onPage(page: number, offset?: number): void;
  onMenuToggle(): void;
  onCommand(cmd: NonNullable<KeyCommand>): void;
  onPageMenu(page: number, at: Point): void;
  /** attempted to move past the last page / before the first */
  onEdge(edge: 'start' | 'end'): void;
  onState(): void;
}

export interface RendererServices {
  book: Book;
  decoder: DecodeClient;
  cache: PageCache;
  host: HTMLElement;
  events: ReaderEvents;
  getConfig(): ReaderConfig;
}

export interface Renderer {
  start(page: number, offset?: number): Promise<void>;
  next(): boolean;
  prev(): boolean;
  goto(page: number, offset?: number): void;
  configChanged(): void;
  resize(): void;
  currentPage(): number;
  pagesShown(): number[];
  zoom(): number;
  zoomBy(factor: number, at?: Point): void;
  zoomReset(): void;
  panBy(dx: number, dy: number): void;
  destroy(): void;
  /** number of live canvases (debug/e2e) */
  canvasCount(): number;
  debugCanvases(): { w: number; h: number; tile: boolean }[];
  visibilityHidden(): void;
  /** fractional scroll offset within the current page (webtoon), else undefined */
  pageOffset(): number | undefined;
}
