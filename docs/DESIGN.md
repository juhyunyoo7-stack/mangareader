# MangaReader - Design (v1.0, 2026-10-13)

Owner: one person. Targets: Windows (Edge/Chrome), iPad + iPhone (Safari, home-screen app), Android phone (Chrome).
Inputs: `docs/RESEARCH.md`. This document is the implementation contract for AI implementers (Sonnet). Where it says MUST, do not deviate without updating this file.

Evidence tags (same as RESEARCH.md): **[V]** primary source seen, **[S]** secondary source, **[U]** unverified - must be tested on a real device. Section 16 lists every [U] that matters.

---

## 0. Spot-verification of load-bearing platform claims (done 2026-10-13)

| Claim | Result | Source |
|---|---|---|
| iOS Safari has no `showOpenFilePicker` / `showDirectoryPicker` | Confirmed: not supported through iOS Safari 26.x | [V] MDN compat (showDirectoryPicker: Safari iOS "No"); caniuse showSaveFilePicker (iOS to 26.5 unsupported); Apple dev forum thread 816515 |
| OPFS on iOS | Available since Safari/iOS 15.2; `createSyncAccessHandle` is worker-only; exclusive lock per file; WebKit lacks Chromium's `readwrite-unsafe` mode | [V] webkit.org/blog/12257; [V] WebKit bug 283959 |
| Storage quota for home-screen apps | Safari 17+: origin quota up to ~60% of disk for browser apps; home-screen web apps get the same quota as Safari; no more "use more space?" prompt | [V] webkit.org "Updates to Storage Policy" |
| Eviction | Home-screen web apps exempt from ITP 7-day script-storage deletion (own usage counter). `navigator.storage.persist()` reportedly always returns `false` on WebKit (bug open) | [V] webkit.org tracking-prevention; [V] WebKit bug 271401 (open) |
| Canvas area cap | 16,777,216 px (4096x4096) per canvas on iOS; failure can be silent (blank canvas); total canvas memory is also capped (device-dependent) | [S] pqina.nl (2022), Adobe forum (2023), Apple forum 687866. No 2025-2026 Apple doc found -> treat as still true |
| WebContent memory ceiling | ~1.5 GB per WebContent process on most iPhones, higher on iPads, undocumented; jetsam kills page ("A problem repeatedly occurred") | [S] WebKit bugs 268816, 256703, 279637 (WebKit engineer comments) |
| Blob URLs | `URL.revokeObjectURL` may not free memory on iOS Safari (long-lived SPA growth) | [S] WebKit bug 257371 (open, 2023) |
| `File` from `<input>` on iOS | A zip-image viewer reading many entries from a picked `File` fails after ~1000 reads with "I/O read operation failed" (also in WKWebView) | [S] Apple dev forum 700639 / WebKit bug 236692 |
| `<input accept=".cbz">` on iOS | Extension filters are not honored on iOS; non-matching files are greyed out | [S] input-file-accept compat table, multiple forums |
| Web Share Target (`share_target`) on iOS | Not supported (iOS Safari through 26.x / 27.1) -> a PWA cannot appear in the iOS share sheet / "Open in" | [V] caniuse mdn-manifests_webapp_share_target; WebKit bug 194593 open |
| File System Access on Android Chrome | Enabled on Android from Chrome M132 (`FileSystemAccessLocal`) | [V] blink-dev "Intent to Ship: File System Access on Android and WebView". `showDirectoryPicker` on Android: [U] -> feature-detect |
| JPEG XL | Safari 17+ decodes JXL natively [S]; Chrome announced JXL decoding "starting from Chrome 155" (blog dated 2026-10-06) - default-on status and Android coverage not stated [V/U] | developer.chrome.com/blog/jpeg-xl-in-chrome |
| WebP / AVIF | WebP Safari 14+, AVIF Safari 16+ (iOS 16+), Chrome long-standing | [S] (widely documented; low risk) |
| `createImageBitmap` resize options in Safari | Code exists in WebKit (`resizeWidth/Height/Quality`) but version not confirmed; options are hard to feature-detect | [S] WebKit ImageBitmap.cpp, WebKit bug 182424 -> runtime probe required |
| WASM RAR/7z libraries | libarchive.js last push 2024-04 (stale); `archive-wasm` 2.1.0 bundles libarchive 3.7.7; `libarchive-wasm` 1.2.0 low-level API. All take a whole in-memory buffer | [S] npm/unpkg READMEs |

**Corrections to the brief that follow from this:**
1. iOS "Open in" / share-sheet import into a PWA is **not possible** (no `share_target` on iOS). iOS import = Files-app picker (`<input type=file multiple>`) and drag-and-drop (iPad). Android does get share-target.
2. Never keep reading from a picked `File` on iOS; copy into OPFS at import time.
3. Never use blob URLs for page images; use `ImageBitmap` + canvas with explicit `close()`.

---

## 1. Product principles

1. **Reading first.** Page turn feels instant; the UI disappears while reading; every control is reachable by thumb, keyboard and gamepad.
2. **Local and private.** No accounts, no cloud, no analytics, no third-party network calls. The hosted origin only serves code.
3. **Never lose data.** Progress is written on every page change (debounced 500 ms). Library metadata is exportable at any time. Imports are atomic (half-imported books are rolled back). The app origin URL is fixed forever (changing it orphans all on-device data).
4. **Correct spreads.** Page index (what was read) is separate from spread index (what is shown). Spread mode/offset/overrides are persisted per book and inherited per series.
5. **Bounded memory.** Never decode a whole archive, never hold more decoded pixels than the platform budget, never draw a canvas above the iOS area cap.
6. **Graceful degradation.** Unsupported formats or oversize archives get a clear "convert needed" message with instructions, never a crash or blank page.
7. **One codebase, AI-maintainable.** Pure-function cores (spread layout, panel ordering, zip directory parsing, sync merge) with unit tests; thin platform adapters; small files; explicit types.
8. **No gold-plating.** MVP = CBZ/ZIP/folders/images + paged/double/webtoon + library + progress. Everything else is staged.

---

## 2. Final architecture and rationale

### 2.1 Decision
**Installable PWA** (static files, git-push hosting like EnglishLab/JapaneseLab), TypeScript + Preact, all heavy work in Web Workers, OPFS + IndexedDB storage. **No native wrapper in v1.** A Capacitor iOS shell is a documented, pre-designed escape hatch (section 2.4) behind the `Platform` adapter interface, triggered only by failing the iOS gates in T6/T12.

### 2.2 Alternatives weighed

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| **PWA** | One deploy for all 3 platforms; owner already ships PWAs; no app store, no signing, no Mac needed; instant updates; FSA folders on Windows/Android | iOS: no share-sheet import, no folder reference-in-place, copy-in only; `persist()` unreliable; WebContent memory ceiling; canvas cap | **Chosen.** Every must-have in RESEARCH.md section 3 is achievable; iOS gaps are UX friction, not blockers |
| Capacitor (iOS) | Share-sheet "Open in", document types, security-scoped folder bookmarks (read library in place from Files/SMB), app-sandbox storage not subject to web eviction | Requires Xcode on a Mac + Apple signing (free 7-day re-sign or paid program); same WKWebView memory/canvas limits; second build pipeline | **Escape hatch only** (section 2.4). Owner's planned Mac mini makes it feasible later |
| Tauri 2 | Native Rust archive/RAR/7z/JXL decode; great Windows desktop | Mobile still disputed maturity [S]; Rust toolchain for AI agents; still WebView on iOS | Rejected for v1. Windows PWA in Edge already has FSA folders |
| Flutter | Own renderer, no WebView memory issue | Full rewrite in Dart; RAR needs FFI; owner's stack is web | Rejected |
| React Native | Mature mobile | Windows weak; rewrite | Rejected |

Key honest risk: iPad memory with huge pages. Native wrappers do **not** fix this (same WKWebView); only bounded decoding does. So the wrapper decision does not hinge on memory.

### 2.3 How each platform imports and stores books

| Platform | Import paths | Storage mode | Notes |
|---|---|---|---|
| **Windows** (Edge/Chrome, installed PWA) | (a) "Add library folder" -> `showDirectoryPicker({mode:'read'})`, recursive scan; (b) "Open files" -> `showOpenFilePicker({multiple:true})`; (c) drag & drop files/folders onto the window (`DataTransferItem.getAsFileSystemHandle()`); (d) File Handling API `file_handlers` in manifest so `.cbz/.cbr/.cb7/.zip/.pdf/.epub` open with the app via `launchQueue` [S] | **Reference-in-place**: store `FileSystemDirectoryHandle`/`FileSystemFileHandle` in IndexedDB; read on demand with `getFile().slice()`. No copy. | On each launch, call `handle.queryPermission()`; if `prompt`, show one "Reconnect library" button that calls `requestPermission()` (needs a user gesture). Option "Copy to app storage" per book for offline-safe reading of external drives |
| **iPad / iPhone** (Safari, Add to Home Screen) | (a) "Import" button -> `<input type=file multiple>` with **no `accept` attribute** (extension filters grey files out); validate by magic bytes after pick; (b) iPad drag & drop from Files app in Split View/Stage Manager onto the window [U]; (c) folder pick via `<input webkitdirectory>` only if feature-detected [U]; (d) "Import from sync host" (section 9, phase 2) | **Copy-in to OPFS** immediately, streamed chunk-by-chunk in a worker (`File.stream()` -> `createSyncAccessHandle().write()`), progress bar, cancel, atomic rename on completion | Reading always from OPFS (`getFile()` from OPFS is a lazily-sliceable File). Storage meter in Settings using `navigator.storage.estimate()`. Call `persist()` anyway and display result (expect `false` on WebKit) |
| **Android** (Chrome, installed PWA) | (a) `showOpenFilePicker` / `showDirectoryPicker` when feature-detected (FSA on Android since M132 [V]; directory picker [U]); (b) fallback `<input type=file multiple>`; (c) **Web Share Target**: manifest `share_target` with `method: POST`, `enctype: multipart/form-data`, files param, handled in the service worker -> copy into OPFS; (d) File Handling not available on Android -> share target covers "Open with" | Reference-in-place if a handle was obtained and permission persists, else copy-in to OPFS | Android content-URI-backed handles may lose permission across restarts [U] -> on failure, offer "copy to app storage" |

All import paths converge on one function: `importSource(source: ImportSource): Promise<BookId[]>` where `ImportSource = {kind:'handle'|'file'|'opfs', ...}`.

### 2.4 Big libraries within quotas

- Desktop: reference-in-place, so app storage only holds IndexedDB metadata + thumbnails (~30 KB per book cover, ~5 KB per page thumbnail generated lazily and evictable). 10,000 books ~ 300 MB thumbnails worst case; thumbnails live in a separate OPFS cache dir with LRU cap (default 500 MB, configurable).
- iOS: copy-in. Quota ~60% of disk [V], but device space is the real limit. Features:
  - Storage meter (used / estimate) on Library and Settings.
  - "Offload" per book/series: delete the archive bytes, keep metadata, progress, cover; book shows a cloud-less "offloaded" badge and re-import matches it back by content key (section 5.2).
  - Optional auto-offload: "Offload volumes finished more than N days ago" (default off).
  - Import refuses with a clear message if `estimate().quota - usage < fileSize * 1.1`.
- Eviction defense (iOS): because `persist()` is unreliable, (1) home-screen install is required and the app shows an install hint when running in a Safari tab; (2) metadata backup export is one tap and a reminder appears every 14 days if no backup/sync happened.

### 2.5 Escape hatch: Capacitor iOS shell (not built in v1)
Trigger: any of these fails on real iPad/iPhone: G1 import of a 2 GB CBZ into OPFS; G2 data still present after 30 days of normal use; G3 owner finds Files-picker import too painful. Then add `platform/capacitor.ts` implementing the same `Platform` interface (file import via document picker plugin, share extension "Open in", security-scoped folder bookmarks, sandbox storage). Requires the Mac mini + Xcode. Core/engine code unchanged.

### 2.6 Hosting
Static build to `dist/`, pushed to the owner's static host (same flow as EnglishLab/JapaneseLab). HTTPS required. Hash routing (`#/library`, `#/read/<bookId>`) so no server rewrites are needed. Base path configurable in `vite.config.ts`. **The production origin is frozen once the owner starts using it.**

---

## 3. Tech stack and module layout

### 3.1 Stack (all runs on this Windows PC with Node 22 + npm 10, verified installed)
- **TypeScript 5.x, strict mode.**
- **Preact 10 + @preact/signals** for the app shell/UI (3-4 KB; React idioms that AI agents know best; JSX gives typed components). Justification vs vanilla TS: the library/settings UI has many lists, dialogs and forms; vanilla DOM code drifts in style across agent sessions. Justification vs React: size. vs Svelte/Lit: fewer agent-familiar idioms, compiler magic. **The reader engine (canvas, gestures, workers) is framework-free TS** and is mounted into a Preact host component - no per-frame VDOM work.
- **Vite** (dev server, build), **vite-plugin-pwa** in `injectManifest` mode (custom SW needed for Android share-target POST handling).
- **idb** (tiny promise wrapper for IndexedDB).
- **fflate** (inflate for ZIP entries; also used to generate fixtures).
- **pdfjs-dist** (lazy-loaded).
- **archive-wasm** or **libarchive-wasm** (lazy-loaded, RAR/7z); pick by benchmark in T20; wrapped behind `ArchiveReader` so it is swappable.
- JXL fallback decoder: a WASM JXL decoder (e.g. `@jsquash/jxl` or jxl-oxide WASM) lazy-loaded only when native decode fails [U for current package state; pick in T24].
- **Vitest** (unit), **Playwright** (e2e), **ESLint + Prettier**.
- No CSS framework; CSS custom properties + one `tokens.css`.

### 3.2 Directory layout
```
MangaReader/
  docs/ RESEARCH.md DESIGN.md
  index.html  vite.config.ts  tsconfig.json  package.json  playwright.config.ts
  public/ manifest.webmanifest icons/
  scripts/
    gen-fixtures.ts          # programmatic test fixtures (section 14)
  src/
    main.tsx                 # boot: platform detect, DB open, router
    sw.ts                    # service worker (precache, share_target POST)
    app/                     # Preact UI shell
      router.ts  App.tsx
      library/  LibraryView.tsx SeriesView.tsx BookCard.tsx Search.tsx Collections.tsx
      reader/   ReaderHost.tsx Overlay.tsx PageSlider.tsx ThumbStrip.tsx QuickSettings.tsx
      settings/ SettingsView.tsx Storage.tsx Controls.tsx Privacy.tsx Sync.tsx
      components/ (Button, Dialog, Sheet, Toast, ProgressBar, Icon)
      styles/ tokens.css base.css
    core/                    # PURE logic, no DOM, 100% unit-tested
      types.ts               # all shared types (section 4)
      spread.ts              # layoutSpreads(), pageToSpread(), spreadToPage()
      naming.ts              # filename -> {series, volume, chapter, title}; natural sort
      comicinfo.ts           # ComicInfo.xml parser
      contentKey.ts          # book identity (section 5.2)
      panels.ts              # panel detection on luminance buffer + reading order
      trim.ts                # margin bounding box on luminance buffer
      edgeMatch.ts           # spread-offset auto-detect score
      syncMerge.ts           # merge of exported/remote state
      memoryBudget.ts        # budgets per device class
    archive/
      ArchiveReader.ts       # interface
      zip/ zipDirectory.ts (central dir + zip64 parser)  zipReader.ts
      folder/ folderReader.ts
      pdf/ pdfReader.ts
      epub/ epubReader.ts    # image-based EPUB -> page list
      libarchive/ libarchiveReader.ts (WASM, lazy)
      detect.ts              # magic-byte format detection
      imageFormats.ts        # header-only dimension probe (JPEG/PNG/WebP/AVIF/GIF/JXL)
    workers/
      decode.worker.ts       # archive entry -> ImageBitmap (downscaled / tiled), filters, trim, panels
      import.worker.ts       # streaming copy into OPFS, scan, hashing, cover generation
      rpc.ts                 # tiny typed postMessage RPC
    engine/                  # reader engine, framework-free
      Reader.ts              # state machine; owns PageCache, Renderer, Input
      PageCache.ts           # LRU of decoded bitmaps under byte budget
      Prefetcher.ts
      PagedRenderer.ts       # single/double, canvas per visible page
      WebtoonRenderer.ts     # virtualised continuous scroll, tiles
      Viewport.ts            # fit modes, zoom/pan math (pure, tested)
      Gestures.ts            # pointer events: tap zones, swipe, pinch, double-tap, pan
      Keyboard.ts Gamepad.ts Wheel.ts
      GuidedView.ts          # panel-by-panel camera
      filters.ts             # CSS filter strings + WebGL sharpen pass
    data/
      db.ts                  # IndexedDB schema + migrations
      repo/ books.ts series.ts progress.ts bookmarks.ts settings.ts collections.ts history.ts
      opfs.ts                # OPFS paths, atomic write, delete, usage
      backup.ts              # export/import JSON
    platform/
      Platform.ts            # interface: capabilities + import + storage
      web.ts                 # feature detection; FSA vs input vs share-target
    sync/ (phase 2) webdav.ts sidecarClient.ts
  sidecar/ (phase 2)         # optional Node sync host for Windows (section 9)
  tests/
    unit/ (mirrors src/core, src/archive, src/engine/Viewport)
    e2e/ library.spec.ts reader.spec.ts webtoon.spec.ts import.spec.ts offline.spec.ts
    fixtures/ (generated, git-ignored except tiny RAR/7z binaries)
```

Rules for implementers: files <= ~400 lines; `core/` never imports DOM or `idb`; workers communicate only via `workers/rpc.ts` typed messages; all user-visible strings in `app/strings.ts` (English default; Korean added later, owner preference).

---

## 4. Core types

```ts
type BookId = string;           // ulid
type SeriesId = string;         // ulid
type Direction = 'ltr' | 'rtl' | 'vertical';
type LayoutMode = 'single' | 'double' | 'auto' | 'webtoon';   // auto = double in landscape, single in portrait
type FitMode = 'screen' | 'width' | 'height' | 'original';
type BookFormat = 'zip' | 'rar' | '7z' | 'pdf' | 'epub' | 'folder' | 'image';

interface PageInfo { index: number; entry: string; w: number; h: number; wide: boolean; }  // wide = w/h >= 1.0 * wideThreshold(default 1.0 relative to portrait, i.e. landscape)
interface PageOverride { index: number; kind: 'single' | 'spreadStart' | 'hidden'; }
interface ReaderPrefs {               // per book; null field = inherit series -> global
  direction?: Direction; layout?: LayoutMode; fit?: FitMode;
  coverOffset?: boolean;              // true = page 0 alone, pairs start at 1
  pairShift?: 0 | 1;                  // manual shift of pairing parity after cover
  autoTrim?: boolean; filters?: FilterPrefs;
}
interface Spread { pages: number[]; }  // 1 or 2 page indices, in visual order resolved by renderer per direction
```

### 4.1 Spread layout algorithm (core/spread.ts, pure)
`layoutSpreads(pages: PageInfo[], prefs: {coverOffset, pairShift, overrides, layout}) -> Spread[]`
1. If layout is `single` or `webtoon`: one spread per page (hidden pages removed).
2. Walk pages in order with a `pending` slot:
   - Hidden pages are skipped.
   - Page 0 when `coverOffset` -> alone.
   - Wide pages -> flush pending alone, then the wide page alone.
   - Override `single` -> flush pending alone, page alone.
   - Override `spreadStart` -> flush pending alone, page starts a new pair.
   - `pairShift = 1` inserts one virtual break after the cover (equivalent to `spreadStart` on page 2 when coverOffset, page 1 otherwise).
   - Else pair with pending.
   - Last page left pending -> alone.
3. Return spreads. `pageToSpread(i)` and `spreadToPage(s)` (returns the lowest page index in the spread) are derived maps.
- **Progress is stored as page index only.** On layout change, the reader re-derives the spread containing the stored page index (fixes the MangaDex/Mihon "index jumps" bugs).
- Visual order: in `rtl`, a pair `[a,b]` renders b on the left, a on the right.
- Auto-offset suggestion (`core/edgeMatch.ts`): for candidate pairings with offset 0 and 1, compute mean edge-continuity score between facing inner edges (8-px columns of downscaled luminance, normalized cross-correlation) over up to 20 sampled pairs; if one parity scores higher by margin > 0.15, show a one-tap toast "Pages look shifted - fix pairing?" Never auto-apply silently.

---

## 5. Data model (IndexedDB `mangareader`, version 1)

### 5.1 Object stores

| Store | Key | Indexes | Value |
|---|---|---|---|
| `sources` | `id` | - | `{id, kind:'fsaDir'|'fsaFile'|'opfs', name, handle?: FileSystemHandle, addedAt, lastScanAt}` |
| `books` | `id` | `seriesId`, `contentKey` (unique), `addedAt`, `lastReadAt`, `titleSort` | `{id, contentKey, sourceId, location:{kind:'handle', path:string[]}|{kind:'opfs', path}|{kind:'offloaded'}, fileName, size, mtime, format, pageCount, pages: PageInfo[] (filled lazily, includes dims), title, seriesId, volume?, chapter?, number?, comicInfo?: ComicInfo, coverThumbKey, prefs: ReaderPrefs, overrides: PageOverride[], status:'unread'|'reading'|'read', addedAt, lastReadAt?, broken?:{reason, convertHint}}` |
| `series` | `id` | `nameSort`, `lastReadAt` | `{id, name, nameSort, prefs: ReaderPrefs, coverBookId, bookIds (ordered), tags[], addedAt, lastReadAt}` |
| `progress` | `bookId` | `updatedAt` | `{bookId, contentKey, page, pageCount, percent, webtoonOffset?: number (fraction within page), finished:boolean, updatedAt, deviceId}` |
| `bookmarks` | `id` | `bookId`, `createdAt` | `{id, bookId, contentKey, page, note?, thumbKey?, createdAt, updatedAt, deleted?:boolean}` |
| `collections` | `id` | `name` | `{id, name, bookIds[], seriesIds[], createdAt, updatedAt}` |
| `history` | autoInc | `bookId`, `at` | `{bookId, at, fromPage, toPage, durationSec}` (one row per session, capped 5,000 rows) |
| `pageCache` | `[bookId, page]` | - | `{trimBox?, panels?: Rect[], edgeSig?}` derived analysis; safe to clear |
| `settings` | `key` | - | `{key, value}`; keys: `global.prefs`, `controls`, `theme`, `privacy`, `sync`, `deviceId`, `lastBackupAt`, `schemaVersion` |

Thumbnails are files in OPFS `thumbs/<bookId>/cover.webp` and `thumbs/<bookId>/p<NNNN>.webp` (not in IDB; easy LRU deletion).
Archives copied-in live at OPFS `books/<bookId>/<fileName>`; imports are written to `incoming/<tmpId>` and renamed only on success.

Migrations: `db.ts` has `migrations: Record<number, (tx) => void>`; every schema change bumps version and adds a migration + a unit test that opens a v(n-1) fixture DB (fake-indexeddb).

### 5.2 Book identity (`contentKey`)
`contentKey = sha256(size || first 256 KiB || last 256 KiB || sorted entry-name list)` as hex (first 32 chars). Computed at import with `crypto.subtle`. Used to: dedupe imports, re-attach offloaded books, match progress across devices in sync, detect duplicates with different filenames. Duplicate hint (library) = same contentKey, or same normalized series+volume with size within 2%.

### 5.3 Prefs inheritance
Effective prefs = book.prefs ?? series.prefs ?? global.prefs ?? defaults. ComicInfo `Manga=YesAndRightToLeft` sets series default direction `rtl` (only if user has not set it). Changing a pref in the reader asks "This book / whole series" (remember last choice).

---

## 6. Archive and format support

Interface (`archive/ArchiveReader.ts`):
```ts
interface ArchiveReader {
  listEntries(): Promise<Entry[]>;            // name, size, compressed, method
  readEntry(name: string): Promise<Uint8Array>;
  close(): void;
}
```
Opened by `openArchive(file: Blob, format)`. `Blob` is either an FSA `File` (desktop) or an OPFS `File` (iOS); both support lazy `slice()`.

| Format | Implementation | Memory behavior | Fallback |
|---|---|---|---|
| CBZ/ZIP | Own central-directory parser (`zipDirectory.ts`, supports ZIP64, data descriptors, UTF-8 + CP437/Shift-JIS/CP949 name decoding heuristics) reading only the tail via `blob.slice()`; per-entry `slice()` + fflate `inflateSync` (stored entries returned directly) | Only requested entries in memory; works for multi-GB files | Encrypted entries -> "password-protected ZIP not supported" |
| Folder of images | FSA directory handle (desktop/Android) or OPFS dir (iOS import of multiple images creates a folder book) | Per file | - |
| Single image | Book with one page | - | - |
| CBR/RAR (v4, v5, solid), CB7/7z | WASM libarchive (lazy chunk, ~1-2 MB) in decode worker; whole archive buffer required | Archive size limit by device class: iPhone 300 MB, iPad 600 MB, desktop 2 GB (`memoryBudget.ts`). On open, extract all image entries once into OPFS `extracted/<bookId>/` (streaming one entry at a time to disk), then free the buffer; subsequent reads behave like a folder book | Above limit, or WASM failure: book marked `broken.convertHint='Convert to CBZ'` with instructions; on desktop, a "Convert to CBZ" action writes a CBZ next to the source using FSA write permission |
| PDF | pdfjs-dist, lazy; render each page to `OffscreenCanvas` when supported, else main-thread canvas, at target device-pixel size capped by tile rules | pdf.js holds the document; pages rendered on demand | Encrypted PDF -> message |
| EPUB (image-based / fixed-layout) | It is a ZIP: parse `META-INF/container.xml` -> OPF -> spine; for each spine XHTML take the first `<img src>` or `<svg><image href>`; spine order = page order; `rendition:spread`/`page-progression-direction` -> prefs | Same as ZIP | If >30% of spine items have no image or have >200 chars of text -> "text EPUB not supported" |
| Images inside archives | JPEG, PNG, GIF (first frame), WebP, AVIF, JXL, BMP | - | Decode failure -> placeholder page with filename + "cannot decode" |

Entry filtering: ignore `__MACOSX/`, dotfiles, `Thumbs.db`, non-images; `ComicInfo.xml` parsed if present. Page order: natural sort of full entry path (`naming.ts`), unless ComicInfo `<Pages>` gives explicit order.

Image format detection is by magic bytes, never by extension. JXL path: try native `createImageBitmap(blob)`; on failure (Chromium without JXL, Android), lazy-load WASM decoder -> RGBA -> `ImageData` -> `createImageBitmap`. AVIF on old iOS (<16): placeholder with message (out of scope).

---

## 7. Reading engine

### 7.1 Decode pipeline (off main thread)
`decode.worker.ts` owns archive readers (one per open book). Request `{book, page, targetW, targetH, tile?, filters?}` -> response transferable `ImageBitmap`(s).
1. Read entry bytes.
2. Probe dimensions from header (`imageFormats.ts`) without decoding.
3. Decode with `createImageBitmap(blob, {resizeWidth, resizeHeight, resizeQuality:'high'})` when the runtime probe (`capabilities.bitmapResize`, tested at boot with a 4x4 PNG -> 2x2) passes; else full decode then downscale by drawing into an `OffscreenCanvas` (if `capabilities.offscreen2d`) in steps of <= 2x for quality; else send full bitmap to main thread and downscale there (last resort).
4. Target size = display CSS px x devicePixelRatio x zoomFactor, clamped so **w x h <= 16,000,000 and max(w,h) <= 8192**; if a page needs more (deep zoom, webtoon strips), it is delivered as **tiles** of max 2048 x 2048.
5. Close every intermediate bitmap (`bitmap.close()`).

Main thread draws bitmaps into `<canvas>` elements sized to the bitmap (never larger than the cap), then closes them when evicted. **No blob URLs, no `<img>` for pages.**

### 7.2 Memory budget and cache
`memoryBudget.ts`: device class from `navigator.deviceMemory` (Chromium) or UA + screen heuristics (iOS):
- iPhone: decoded budget 200 MB, max 2 live canvases beyond visible.
- iPad: 350 MB.
- Desktop/Android >= 8 GB: 800 MB; Android < 8 GB: 250 MB.
Bytes per bitmap = w*h*4. `PageCache` is an LRU keyed `(bookId, page, tileId, scaleBucket)`; evicts + `close()` when over budget. Visible pages are pinned.
On `visibilitychange` -> hidden: drop all non-visible bitmaps. On `pagehide`: drop all.

### 7.3 Prefetch window
Paged: decode current spread, then +1, +2 spreads forward, -1 back (direction-aware). Double mode doubles page count. Cancel stale requests when the user jumps (slider). Webtoon: decode tiles within 1.5 viewport heights above and 2.5 below.

### 7.4 Layout modes
- **Single / Double / Auto** (section 4.1). Auto: double when viewport aspect > 1.2 (landscape), else single. Lone pages in double mode are centered; option "align lone page to spine".
- **Direction**: LTR, RTL (tap zones and swipe mirrored, slider mirrored), vertical paged (swipe up/down).
- **Webtoon** (continuous vertical): virtualised list; each page slot height = page.h scaled to viewport width (dims from header probe, so layout is stable before decode). Pages taller than 2048 device px are split into horizontal tile strips. Slots outside the window hold no canvas. Optional gap 0-16 px. Progress = page index + fractional offset. Scroll is native (`overflow-y: auto`, momentum) for best iOS feel; positions restored from progress.
- **Fit modes**: screen (contain), width, height, original (1:1 device px). Also "fit width, limit to 1.5x upscale".

### 7.5 Zoom, pan, gestures (`Viewport.ts` pure math + `Gestures.ts`)
- Pointer Events only (`touch-action: none` on reader surface; `pan-y` in webtoon). Pinch zoom 1x-8x around the pinch centroid; pan with bounds and rubber-band; inertia; double-tap toggles fit <-> 2.5x at tap point (configurable); ctrl+wheel / trackpad pinch on desktop.
- During a gesture the canvas is scaled by CSS `transform` (GPU, no re-decode). After 150 ms idle, request a re-render at the new scale for only the visible region (tiles), replacing the low-res layer.
- Swipe to turn page only when zoom == fit or the pan is at the edge.

### 7.6 Guided view (panel-by-panel)
- `core/panels.ts` on a 512-px-wide luminance buffer: estimate gutter color from the page border (median of outer 2% ring); binary mask of "non-gutter" with tolerance; recursive X-Y cut (projection profiles, min gutter 1% of size) to depth 4; drop regions < 2% of page area; merge overlaps; fallback to whole page if < 2 panels or > 30.
- Reading order: rows top to bottom (row grouping by vertical overlap > 50%), within a row right-to-left for `rtl`, left-to-right for `ltr`.
- `GuidedView.ts` animates a camera (zoom + pan, 250 ms ease, reduced-motion = instant) to each panel's rect with 4% padding; next/prev steps panels then pages. Results cached in `pageCache`.
- Accuracy target: >= 80% exact panel count on the generated grid fixtures; real-manga accuracy is a known risk (section 15); always one tap away from normal view.

### 7.7 Image filters and auto-trim
- Cheap filters as CSS `filter` on the reader layer: brightness, contrast, sepia, grayscale, invert+hue-rotate(180deg) for night, saturation. Presets: Night (invert-dark for text-heavy pages + warm), Sepia, E-ink gray (grayscale + contrast 1.3), Custom.
- Sharpen: optional WebGL2 unsharp-mask pass in a single shared GL canvas over the visible page (fallback: disabled with note). Off by default.
- Auto-trim: `core/trim.ts` finds the bounding box of content (pixels differing from border color by > tolerance, ignoring < 0.5% noise rows/cols) on a downscaled buffer; crop rect applied at draw time (source rect), uniform across a spread (use union for both pages) to keep alignment. Cached per page.

### 7.8 Reader state machine
`Reader` states: `loading -> ready -> (paged|webtoon|guided)`; events: `next, prev, goto(page), setPrefs, resize, visibilityHidden`. Progress write on each settled page change (debounced 500 ms) + on `pagehide`. Finishing last page marks `finished` and offers "Next volume" (series order).

---

## 8. Library

- **Views**: Continue Reading row (books with 0 < progress < finished, by `lastReadAt`), Series grid, All Books, Folders (desktop source tree), Collections, History, Bookmarks, Offloaded.
- **Series grouping** (`core/naming.ts`): ComicInfo `<Series>` wins; else normalize filename: strip extension, bracketed groups `[...]`, `(...)` tags like scan group/year/resolution, then match volume/chapter tokens (`v01`, `vol.1`, `Volume 1`, `第1巻`, `1권`, `c012`, `ch.12`, `#12`, trailing number); series name = remaining prefix, case/width-folded (NFKC), punctuation-collapsed. For folder sources, the parent folder name is a strong series hint when it contains >1 book. User can merge/split/rename series manually (stored, never overwritten by rescans).
- **ComicInfo.xml**: Series, Number, Volume, Title, Summary, Writer, Penciller, Genre, Tags, Manga, LanguageISO, PageCount, Pages (Type=FrontCover, DoublePage -> `wide` hint). Unknown fields ignored.
- **Covers**: first page (or ComicInfo FrontCover) decoded to 300 px wide WebP thumbnail in the import worker; generated lazily for reference-in-place libraries (visible-first queue).
- **Search**: in-memory index of title/series/tags/writer built at startup (normalized NFKC, lowercase, kana/hangul as-is); prefix + substring match; < 50 ms for 10k books.
- **Sort**: name (natural), recently read, recently added, progress, size.
- **Duplicates**: section 5.2 rules; "Duplicates" filter view with keep/remove actions.
- **History**: sessions list; **Bookmarks**: per page, optional note, thumbnail; jump-to.
- **Scan** (desktop): manual "Rescan" + on-launch quick scan comparing name+size+mtime; missing files flagged, not deleted.

---

## 9. Sync (no accounts, no cloud)

All sync uses one portable document:
```json
{ "format": "mangareader-state", "version": 1, "deviceId": "...", "exportedAt": "...",
  "books": [{ "contentKey": "...", "title": "...", "series": "...", "fileName": "...", "size": 0 }],
  "progress": [...], "bookmarks": [...], "seriesPrefs": [...], "bookPrefs": [...], "overrides": [...], "collections": [...] }
```
Keyed by `contentKey`, never by local ids. Merge (`core/syncMerge.ts`, pure): per record last-writer-wins on `updatedAt`, ties broken by `deviceId`; progress additionally never regresses a `finished:true` unless the newer record is explicitly newer; bookmarks use tombstones (`deleted`). Merge is commutative and idempotent (unit-tested property).

| Phase | Path | How |
|---|---|---|
| **v1 (MVP)** | Export / import file | Settings -> "Export state" downloads `mangareader-state-YYYYMMDD.json` (iOS: saves to Files; then AirDrop/Files to other device). "Import state" merges. Also serves as backup. |
| **v2** | Windows sidecar over Tailscale | `sidecar/` = a ~300-line Node script (no deps beyond Node stdlib) the owner runs on the Windows PC: `GET/PUT /state` (merged JSON with ETag), `GET /books` (catalog of a configured folder), `GET /books/:key` with HTTP Range. Exposed with `tailscale serve` to get an HTTPS URL on the tailnet (required: an HTTPS PWA cannot call `http://` endpoints - mixed content). CORS allow-origin = the app origin only. Shared secret token in a header (entered once in the app). The app: "Sync now" + auto sync on open/close; "Import from PC" downloads a book straight into OPFS (solves the iOS import friction). |
| **v2 alt** | Generic WebDAV | Same `/state` file PUT/GET to any WebDAV URL; requires the server to send CORS headers for the app origin [U per server]. Offered as advanced option. |

Out of scope: OPDS/Komga/Kavita client (possible later), kosync.

---

## 10. Controls

- **Touch zones** (paged): default 3 columns: left 30% = prev (next in RTL), right 30% = next (prev in RTL), center = toggle overlay. Presets: "L-shape", "Kindle", "Edge only", "Disabled"; custom 3x3 grid editor in Settings (each cell: next/prev/menu/none). Swipe always works.
- **Keyboard**: arrows / PageUp/PageDown / Space (next) / Shift+Space (prev) - direction-aware for left/right; Home/End; `F` fullscreen; `D` cycle layout; `R` toggle RTL; `O` toggle cover offset; `[`/`]` pair shift; `G` guided view; `+`/`-`/`0` zoom; `T` thumbnails; `B` bookmark; `Esc` close overlay / exit reader; `/` search in library.
- **Mouse**: wheel = next/prev in paged (debounced, threshold), scroll in webtoon; ctrl+wheel zoom; middle-drag pan; click zones as touch.
- **Gamepad** (Gamepad API polling only while reader focused): D-pad/shoulders = prev/next, A = toggle overlay, B = back, triggers = zoom, right stick = pan.
- **Volume keys**: not available to web apps (noted, not implemented).

---

## 11. UI/UX spec

- **Theme**: dark default (`#0f0f10` background, `#e8e8e8` text, one accent), light and "black OLED" options; reader background independent (black/gray/white/auto from page border color).
- **Phone portrait**: bottom tab bar (Library, Continue, Collections, Settings); 3-column cover grid; reader overlay = top bar (back, title, bookmark, more) + bottom bar (page slider, layout/direction quick buttons).
- **iPad / tablet**: sidebar (Library sections) + 5-7 column grid; reader auto-double in landscape; supports Split View / Stage Manager resizing (layout recomputes on `resize`, keeps page index).
- **Desktop**: sidebar + grid; reader full window; hover reveals overlay; F11/`F` fullscreen via Fullscreen API (iOS: standalone display already immersive).
- **Immersive mode**: overlay hidden by default while reading; `display: standalone` + `viewport-fit=cover`; respect safe-area insets; status bar `black-translucent`.
- **Thumbnail strip**: horizontal strip above slider, virtualised, current spread highlighted, RTL mirrored.
- **Page slider**: shows page number + small preview tooltip while dragging; commits on release.
- **Quick settings sheet** (in reader): layout, direction, fit, cover offset, pair shift, filters, auto-trim, guided view - each with "book/series" scope.
- **Feedback**: toasts for imports, errors with "Details"; import progress panel.
- **Accessibility**: all controls are real buttons with labels; focus rings; keyboard-navigable library; `prefers-reduced-motion` disables page animations and camera tweening; `prefers-contrast` boosts UI contrast; minimum hit target 44x44 px; text sizes in rem honoring user zoom; reader announces "Page X of Y" via a polite live region on page change (throttled).
- **Page transitions**: none / slide (default, 180 ms) / fade. Page-curl: out of scope.

---

## 12. Performance budgets (measured in e2e perf tests on desktop Chromium; real-device numbers recorded manually in `docs/DEVICE-LOG.md` when tested)

| Metric | Budget |
|---|---|
| Initial JS (gz) excluding lazy chunks | <= 150 KB |
| Cold start to library interactive (cached SW, 1k books) | <= 1.5 s iPad, <= 1.0 s desktop |
| Open CBZ (1 GB, 300 pages) to first page painted | <= 700 ms desktop, <= 1.2 s iPad |
| Page turn with prefetched spread | <= 50 ms to paint; no frame > 32 ms during slide animation |
| Page turn without prefetch (JPEG 2000x3000) | <= 250 ms desktop, <= 500 ms iPad |
| Webtoon scroll | 60 fps target on desktop; no blank tile visible at normal fling on iPad |
| Decoded bitmap memory | <= budget in section 7.2 at all times (asserted by PageCache counters exposed via `?debug=1` overlay) |
| Library search, 10k books | <= 50 ms |
| Import throughput into OPFS | >= 50 MB/s desktop; iPad recorded |

---

## 13. Privacy and security

- No analytics, no telemetry, no external fonts/CDNs; all assets self-hosted and precached.
- CSP: `default-src 'self'; img-src 'self' blob: data:; connect-src 'self' <user-configured sync host>; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`.
- Optional **app-lock PIN** (4-8 digits): PBKDF2-SHA256 (200k iterations, random salt) hash stored in settings; lock on launch and after N minutes hidden; blur overlay on `visibilitychange`. Clearly labeled as a privacy screen, **not encryption** (files in OPFS are not encrypted). Forgotten PIN -> "Reset app-lock" requires typing RESET and clears the PIN only.
- Sidecar token never logged; the sidecar binds only to localhost (tailscale serve proxies).
- "Erase all data" in Settings (OPFS + IDB + caches), double confirmation.

---

## 14. Testing strategy

- **Unit (Vitest, Node + jsdom where needed, `fake-indexeddb`)**: `spread.ts` (table-driven: cover offset, wide pages, overrides, shift, hidden, RTL visual order, page<->spread round trips, layout change preserves page), `naming.ts` (>= 60 real-world filename cases incl. Japanese/Korean), `comicinfo.ts`, `zipDirectory.ts` (zip64, data descriptor, stored/deflated, Shift-JIS names, truncated archive -> typed error), `epubReader` spine extraction, `panels.ts` + `trim.ts` + `edgeMatch.ts` on synthetic luminance buffers, `Viewport.ts` math, `syncMerge.ts` (commutativity/idempotence property tests), `contentKey.ts`, db migrations.
- **Fixtures** (`scripts/gen-fixtures.ts`, run by `npm run fixtures`): generate PNG/JPEG pages with page numbers drawn as large digits + colored borders (via `pngjs`/`jpeg-js` or `sharp` if prebuilt binaries install cleanly on Windows); CBZ variants with fflate (stored, deflated, zip64 forced, nested folders, Shift-JIS names, ComicInfo with Manga=YesAndRightToLeft, a wide spread page at index 5, a 800x30000 webtoon strip, a 9000x9000 page for tiling); panel grid pages (known rects); pages with white margins (known trim box); split-spread pairs with continuous gradients across the gutter (for edgeMatch); a 2-page PDF (minimal hand-written PDF bytes); an image-based EPUB. RAR/7z fixtures: tiny pre-built binaries committed under `tests/fixtures/static/` (RAR cannot be created without proprietary tooling), each < 50 KB, with their SHA-256 in a README.
- **E2E (Playwright)**: projects `chromium-desktop`, `webkit-desktop`, `webkit-iPad` (device descriptor `iPad Pro 11`, touch), `chromium-Pixel` (Android emulation). Specs: import via file input (setInputFiles), open, page turn by key/tap/swipe, double mode with cover offset and override persisted after reload, RTL order (read page digits via canvas pixel sampling or a `data-page` debug attribute), webtoon virtualization (assert <= N canvases in DOM), progress resume after reload, offline (SW cached, `context.setOffline(true)`), export/import state round trip. FSA picker paths tested with a mocked `showDirectoryPicker` injected via `addInitScript` over OPFS handles.
- **Not covered by automation** (WebKit desktop != iOS): memory ceilings, canvas cap, OPFS quota, eviction, Files picker. Manual checklist in section 16, results logged in `docs/DEVICE-LOG.md`.
- CI-equivalent: `npm run check` = typecheck + lint + unit + e2e (chromium + webkit) locally on Windows before every push.

---

## 15. Task breakdown (implement in order; each task ends green on `npm run check`)

### Phase A - MVP
- **T1 Scaffold.** Vite + TS strict + Preact + signals + ESLint/Prettier + Vitest + Playwright; hash router with Library/Reader/Settings placeholders; `npm run dev|build|check|fixtures`. *Accept:* `npm run build` emits `dist/`; Playwright opens `/` in chromium + webkit and sees "Library".
- **T2 PWA shell.** Manifest (standalone, icons, theme), vite-plugin-pwa injectManifest SW precaching app shell; update prompt (never auto-reload); install hint when not standalone. *Accept:* e2e offline spec: load, go offline, reload, app renders.
- **T3 Core types + spread engine.** `core/types.ts`, `core/spread.ts`. *Accept:* >= 30 table-driven unit tests from section 4.1 incl. round trips and layout-change page preservation.
- **T4 Fixture generator.** `scripts/gen-fixtures.ts` producing the ZIP/image fixtures of section 14 (PDF/EPUB/RAR later). *Accept:* running twice is deterministic (same SHA-256); fixture files open in Windows Explorer zip view.
- **T5 ZIP reader.** `zipDirectory.ts`, `zipReader.ts`, `detect.ts`, `imageFormats.ts` (JPEG/PNG/WebP/GIF/AVIF/JXL dims). *Accept:* unit tests for all ZIP variants; reading entry 250 of a 300-entry 200 MB fixture reads < 2 MB from the Blob (instrumented slice counter).
- **T6 Storage layer + import.** `db.ts` schema v1, repos, `opfs.ts` (atomic write via `incoming/` + rename), `import.worker.ts` streaming copy with progress/cancel, `contentKey.ts`, `platform/web.ts` capability detection, file-input import (no `accept`). *Accept:* e2e: import 3 CBZ via setInputFiles -> 3 books in IDB, archives in OPFS, duplicate re-import is rejected with toast; cancel mid-import leaves no files in `incoming/`. **iOS gate G1 (manual): import 2 GB CBZ on iPad.**
- **T7 Decode worker + PageCache.** `rpc.ts`, `decode.worker.ts` with capability probes (bitmap resize, offscreen 2d), size clamping + tiling, `memoryBudget.ts`, `PageCache.ts`. *Accept:* unit tests for clamp/tiling math; e2e: 9000x9000 fixture page renders as tiles with each canvas <= 16 MP; cache byte counter never exceeds budget while flipping 100 pages (debug overlay value).
- **T8 Paged reader (single).** `Reader.ts`, `PagedRenderer.ts`, `Viewport.ts` fit modes, tap zones, keyboard, swipe, prefetch, progress save/resume. *Accept:* e2e: open book, press Right 5 times -> page 6 (`data-page`), reload -> resumes page 6; RTL book mirrors keys.
- **T9 Double page + overrides.** Auto/double modes, cover offset, pair shift, per-page override UI (long-press / right-click on a page -> "Show alone"/"Start spread here"), book/series scope prompt. *Accept:* e2e: double mode with wide page fixture shows it alone; toggling offset keeps the current page visible; override persists after reload.
- **T10 Zoom/pan/pinch/double-tap.** `Gestures.ts` complete, re-render on settle. *Accept:* unit tests for `Viewport` zoom-around-point and pan bounds; e2e (chromium touch emulation) double-tap zooms to 2.5x and back; swipe does not turn page when zoomed mid-page.
- **T11 Library UI.** Series grouping (`naming.ts` with >= 60 cases), ComicInfo parse, covers, Continue Reading, grid, series view, sort, search. *Accept:* unit tests for naming/comicinfo; e2e: 10 fixture books group into expected 3 series; search "vol 2" finds correct book.
- **T12 Webtoon mode.** `WebtoonRenderer.ts` virtualised, tile strips, fractional progress. *Accept:* e2e: 50-page webtoon fixture with 30000-px strip: scroll to bottom, DOM never holds > 12 canvases, resume restores offset within 1 viewport. **iOS gate (manual): scroll a 300-page webtoon on iPhone without reload/jetsam.**
- **T13 Reader overlay UI.** Top/bottom bars, page slider with preview, thumbnail strip (lazy thumbs), quick settings sheet, immersive mode, safe areas. *Accept:* e2e: slider drag to 50% opens middle page; thumbnail click navigates; overlay hidden by default.
- **T14 Desktop FSA library.** `showDirectoryPicker` source, recursive scan, reference-in-place reads, permission reconnect flow, drag & drop of files/folders, rescan diff, File Handling `launchQueue`. *Accept:* e2e with mocked handles: add folder -> books listed without copying (OPFS `books/` empty); reload -> "Reconnect library" button appears when permission is `prompt` (mock) and restores access.
- **T15 Export/import state + backup reminder.** `backup.ts`, `syncMerge.ts`. *Accept:* property tests (merge commutative/idempotent); e2e: export on context A, import on fresh context B with the same CBZ imported -> progress + bookmarks + overrides restored.
- **T16 Storage management (iOS-focused).** Storage meter, offload/re-attach by contentKey, quota pre-check, erase-all. *Accept:* e2e: offload book -> OPFS file removed, progress kept; re-import same file -> re-attached, not duplicated.
- **T17 Android share target.** Manifest `share_target` + SW POST handler -> OPFS import. *Accept:* unit test of SW handler with a synthetic `FormData` request; manual check on Android device logged.

**MVP done = T1-T17.** Owner acceptance: read a real 1-volume CBZ on all three platforms, progress carried by export/import.

### Phase B - Formats and reading quality
- **T18 Bookmarks + history.** *Accept:* e2e add/remove bookmark, list, jump; history row per session.
- **T19 Filters + auto-trim.** CSS presets, `trim.ts`, union crop on spreads, settings scope. *Accept:* unit tests on margin fixtures (box within 2 px); e2e preset toggles CSS filter on reader layer.
- **T20 RAR/7z via WASM.** Benchmark `archive-wasm` vs `libarchive-wasm` on fixtures + owner's real solid CBR on desktop; pick; extract-to-OPFS flow; size limits; "Convert to CBZ" (desktop). *Accept:* fixtures RAR4/RAR5/solid/7z open; over-limit file shows convert message, not crash; benchmark table appended to this doc.
- **T21 PDF.** pdfjs-dist lazy chunk, page render with clamp/tiling. *Accept:* 2-page fixture renders; initial bundle unchanged (lazy).
- **T22 EPUB image-based.** *Accept:* fixture EPUB spine order correct; text EPUB rejected with message.
- **T23 Folder/images books + ComicInfo Pages hints.** *Accept:* folder of 20 PNGs reads as one book; `DoublePage` hint marks wide.
- **T24 JXL fallback.** Native detect + lazy WASM decoder. *Accept:* JXL fixture renders in chromium and webkit projects.

### Phase C - Differentiators and polish
- **T25 Guided view.** `panels.ts`, `GuidedView.ts`. *Accept:* grid fixtures: >= 80% exact panel sets; RTL order correct; reduced-motion = no tween.
- **T26 Auto-offset suggestion.** `edgeMatch.ts` + toast. *Accept:* split-spread fixtures detect the correct parity; no suggestion on unrelated pages.
- **T27 Controls customization + gamepad + wheel.** Zone grid editor, presets, gamepad mapping. *Accept:* unit tests zone hit-testing; e2e custom zone works.
- **T28 Collections, duplicates view, library polish.** *Accept:* e2e create collection, add series; duplicate fixture pair listed.
- **T29 App-lock PIN + privacy screen.** *Accept:* unit test PBKDF2 verify; e2e lock after reload, wrong PIN rejected.
- **T30 Accessibility + responsive pass.** *Accept:* Playwright + axe-core on library/settings with 0 serious violations; iPad/phone/desktop screenshots reviewed.
- **T31 Sharpen (WebGL2) + page transitions.** *Accept:* toggling sharpen changes pixels on fixture (canvas sample); disabled gracefully without WebGL2.
- **T32 Performance pass.** Budgets of section 12 measured in a Playwright perf spec (desktop); bundle-size check in `npm run check`. *Accept:* all desktop budgets met.

### Phase D - Optional sync
- **T33 Sidecar.** `sidecar/server.mjs` (Node stdlib), token auth, `/state`, `/books`, Range; README for `tailscale serve`. *Accept:* node test hits endpoints; Range returns 206.
- **T34 Sync client.** Settings -> sync host + token; sync on open/close; "Import from PC" into OPFS. *Accept:* e2e with sidecar started by Playwright `webServer`: two contexts converge.
- **T35 WebDAV option.** *Accept:* e2e against a local WebDAV test server with CORS (e.g. a tiny Node WebDAV in tests).

---

## 16. Open risks and known-unverified items

### 16.1 Risks
1. **iOS memory**: WebContent ceiling ~1.5 GB iPhone [S], undocumented; jetsam reloads lose reader state -> mitigated by budgets, tiling, progress saved on every page, but real limits unknown.
2. **iOS data eviction**: `persist()` returns false on WebKit [V bug]; home-screen exemption from 7-day ITP [V] but storage-pressure eviction behavior is undocumented -> backup reminder + sidecar sync.
3. **iOS import friction**: no share-sheet/Open-in, no folder reference; copy doubles storage use while the original stays in Files. Mitigation: delete-original hint, sidecar "Import from PC", Capacitor escape hatch.
4. **RAR/7z WASM**: whole-buffer requirement, stale upstreams, solid-archive speed unknown; hard size caps on iOS.
5. **Panel detection quality** on borderless/irregular manga panels - heuristic may disappoint; scope-limited.
6. **JXL**: Chrome 155 default-on not confirmed; WASM decoder package choice pending.
7. **FSA permission persistence** on Windows installed PWA (whether "allow on every visit" persists without prompt) [U]; Android content-URI handle durability [U].
8. **Origin lock-in**: changing hosting URL orphans all device data (mitigated by export/import).
9. **WebKit desktop in Playwright is not iOS** - automated tests cannot catch iOS-only failures.

### 16.2 Known-unverified on real iOS device (must test, log in `docs/DEVICE-LOG.md`)
- [ ] 16.7 MP canvas cap still enforced on current iOS (26.x) and total canvas memory ceiling on owner's iPad/iPhone.
- [ ] Max safe decoded-bitmap budget (start 200 MB iPhone / 350 MB iPad) before jetsam.
- [ ] `createImageBitmap(blob, {resizeWidth,...})` works in Safari and in workers; `OffscreenCanvas` 2D in workers.
- [ ] `createImageBitmap` decodes WebP, AVIF, **JXL** in a worker (native JXL in Safari confirmed only for `<img>` [S]).
- [ ] OPFS streaming write of a 2 GB file via sync access handle in a worker (gate G1); throughput.
- [ ] Reading random entries from an OPFS `File` many times (>2000 reads) without the "I/O read operation failed" error seen with picked Files.
- [ ] `navigator.storage.estimate()` values and actual usable quota in a home-screen app; `persist()` result.
- [ ] Data survives 30 days of normal use + low-storage conditions (gate G2).
- [ ] `<input type=file multiple>` without `accept` lets the owner pick .cbz/.cbr/.pdf from Files, iCloud Drive and SMB locations; `webkitdirectory` availability.
- [ ] iPad drag & drop of files from Files app into the home-screen app.
- [ ] Gesture conflicts: iOS edge-swipe back, pinch on standalone app, `touch-action: none` honored; no rubber-band of the whole page.
- [ ] Native momentum scrolling in webtoon with canvases being attached/detached (no flicker, no blank tiles).
- [ ] Service-worker update flow in standalone mode; app works fully offline after cold start.
- [ ] Safe-area insets / status bar overlap in standalone on iPhone with Dynamic Island.
- [ ] WebGL2 sharpen performance and memory on iPad.
- [ ] pdf.js rendering memory for large scanned PDFs on iPad.
- [ ] WASM libarchive peak memory for a 300 MB CBR on iPhone (validates size cap).
- [ ] Gamepad API with a Bluetooth controller in iPadOS standalone app.

### 16.3 Other unverified (non-iOS)
- [ ] Chrome 155 JXL default-on on Windows and Android.
- [ ] `showDirectoryPicker` on Android Chrome; handle permission persistence after restart.
- [ ] File Handling API (`file_handlers`) behavior for the installed PWA on Windows Edge.
- [ ] Persistent FSA permissions for installed PWA on Windows (no re-prompt each launch).

---

## 17. Sources used for section 0
- https://developer.mozilla.org/en-US/docs/Web/API/window/showOpenFilePicker ; https://caniuse.com/mdn-api_window_showsavefilepicker ; https://developer.apple.com/forums/thread/816515
- https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/ ; https://bugs.webkit.org/show_bug.cgi?id=283959
- https://webkit.org/blog/14403/updates-to-storage-policy/ ; https://bugs.webkit.org/show_bug.cgi?id=271401 ; https://webkit.org/tracking-prevention/
- https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ ; https://developer.apple.com/forums/thread/687866
- https://bugs.webkit.org/show_bug.cgi?id=268816 ; https://bugs.webkit.org/show_bug.cgi?id=256703 ; https://bugs.webkit.org/show_bug.cgi?id=279637 ; https://bugs.webkit.org/show_bug.cgi?id=257371
- https://developer.apple.com/forums/thread/700639 ; https://bugs.webkit.org/show_bug.cgi?id=236692
- https://caniuse.com/mdn-manifests_webapp_share_target ; https://bugs.webkit.org/show_bug.cgi?id=194593
- https://groups.google.com/a/chromium.org/g/blink-dev/c/x3IcFv2jY6c (FSA on Android, M132)
- https://developer.chrome.com/blog/jpeg-xl-in-chrome (Chrome 155)
- https://webkit.googlesource.com/WebKit/+/master/Source/WebCore/html/ImageBitmap.cpp ; https://bugs.webkit.org/show_bug.cgi?id=182424
- https://npmjs.org/package/libarchive.js ; https://unpkg.com/archive-wasm@2.1.0/README.md ; https://github.com/ofk/libarchive-wasm
