export type BookId = string;
export type SeriesId = string;
export type Direction = 'ltr' | 'rtl' | 'vertical';
export type LayoutMode = 'single' | 'double' | 'auto' | 'webtoon';
export type FitMode = 'screen' | 'width' | 'height' | 'original';
export type BookFormat = 'zip' | 'rar' | '7z' | 'pdf' | 'epub' | 'folder' | 'image';

export interface PageInfo {
  index: number;
  entry: string;
  w: number;
  h: number;
  /** landscape page (a double-page scan) */
  wide: boolean;
}

export type OverrideKind = 'single' | 'spreadStart' | 'hidden';
export interface PageOverride {
  index: number;
  kind: OverrideKind;
}

export type FilterPreset = 'none' | 'dim' | 'invert-soft' | 'sepia' | 'eink';

export interface FilterPrefs {
  preset: FilterPreset;
  /** 0.5..1.5, applied on top of the preset */
  brightness: number;
  contrast: number;
}

export const DEFAULT_FILTERS: FilterPrefs = { preset: 'none', brightness: 1, contrast: 1 };

export interface ReaderPrefs {
  direction?: Direction;
  layout?: LayoutMode;
  fit?: FitMode;
  /** true = page 0 alone, pairs start at 1 */
  coverOffset?: boolean;
  pairShift?: 0 | 1;
  filters?: FilterPrefs;
  /** crop uniform page margins (paged layouts) */
  autoTrim?: boolean;
  /** panel-by-panel reading */
  guided?: boolean;
}

export interface Spread {
  /** 1 or 2 page indices in reading order */
  pages: number[];
}

export interface ComicInfo {
  series?: string;
  number?: string;
  volume?: string;
  title?: string;
  summary?: string;
  writer?: string;
  penciller?: string;
  genre?: string;
  tags?: string;
  manga?: string;
  languageISO?: string;
  pageCount?: number;
  pages?: { image: number; type?: string; doublePage?: boolean }[];
}

export type BookLocation =
  | { kind: 'handle'; sourceId: string; path: string[] }
  | { kind: 'opfs'; path: string }
  | { kind: 'offloaded' };

export interface BrokenInfo {
  reason: string;
  convertHint?: string;
}

export interface Book {
  id: BookId;
  contentKey: string;
  location: BookLocation;
  fileName: string;
  size: number;
  mtime: number;
  format: BookFormat;
  pageCount: number;
  pages: PageInfo[];
  title: string;
  titleSort: string;
  seriesId: SeriesId;
  volume?: number;
  chapter?: number;
  number?: number;
  comicInfo?: ComicInfo;
  hasCover: boolean;
  prefs: ReaderPrefs;
  overrides: PageOverride[];
  /** updatedAt (ms) for prefs+overrides, used by sync merge */
  prefsUpdatedAt: number;
  status: 'unread' | 'reading' | 'read';
  addedAt: number;
  lastReadAt?: number;
  broken?: BrokenInfo;
  missing?: boolean;
}

export interface Series {
  id: SeriesId;
  /** normalised key used for grouping */
  key: string;
  name: string;
  nameSort: string;
  prefs: ReaderPrefs;
  coverBookId?: BookId;
  addedAt: number;
  lastReadAt?: number;
}

export interface Progress {
  bookId: BookId;
  contentKey: string;
  page: number;
  pageCount: number;
  percent: number;
  /** fraction (0..1) of the page already scrolled past, webtoon only */
  webtoonOffset?: number;
  finished: boolean;
  updatedAt: number;
  deviceId: string;
}

export interface Bookmark {
  id: string;
  bookId: BookId;
  contentKey: string;
  page: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface SourceRecord {
  id: string;
  kind: 'fsaDir' | 'fsaFile' | 'opfs';
  name: string;
  handle?: FileSystemHandle;
  addedAt: number;
  lastScanAt?: number;
}

export interface GlobalPrefs extends ReaderPrefs {
  direction: Direction;
  layout: LayoutMode;
  fit: FitMode;
  coverOffset: boolean;
  pairShift: 0 | 1;
  filters: FilterPrefs;
  autoTrim: boolean;
  guided: boolean;
}

export const DEFAULT_PREFS: GlobalPrefs = {
  direction: 'ltr',
  layout: 'auto',
  fit: 'screen',
  coverOffset: true,
  pairShift: 0,
  filters: DEFAULT_FILTERS,
  autoTrim: false,
  guided: false,
};

export type Theme = 'dark' | 'light' | 'oled';
export type ZonePreset = 'standard' | 'edge' | 'off';
export type Transition = 'none' | 'slide' | 'fade';

export interface UiSettings {
  theme: Theme;
  zones: ZonePreset;
  transition: Transition;
  wheelTurnsPage: boolean;
  doubleTapZoom: boolean;
  webtoonGap: number;
}

export const DEFAULT_UI: UiSettings = {
  theme: 'dark',
  zones: 'standard',
  transition: 'slide',
  wheelTurnsPage: true,
  doubleTapZoom: true,
  webtoonGap: 0,
};
