# Manga/Comic Reader - Research Report (2026-10-13)

Goal: best-in-class personal manga/comic reader for Windows + iPad + phones (iOS/Android), local files, no accounts.

## 0. Method and honesty notes

- The Aside browser agent was tried first (`mcp__aside__exec`); it returned nothing for 1800 s and was aborted. `mcp__aside__repl` returned empty output. Fallback: the built-in WebSearch tool (English queries). No direct Reddit threads were retrieved (search returned none), so "complaints" come from GitHub issues, App Store review summaries, forums and docs.
- Confidence tags: **[V]** = seen in an official/primary source in search results; **[S]** = secondary/third-party (blog, aggregator), plausible; **[U]** = unverified / from model memory or conflicting. Search results were summaries, not full page fetches; anything load-bearing should be re-checked before design lock-in.
- Not covered by any retrieved source (marked unknown): Cover / Comic Screen apps, Bandiview JXL, Perfect Viewer cover-offset, CDisplayEx official feature docs, Kindle Panel View internals for CBZ, Calibre viewer comic specifics.

## 1. Feature matrix (what each app is known to do)

| App | Platforms | Formats | Reading modes / spreads | Notes |
|---|---|---|---|---|
| Mihon (ex-Tachiyomi) | Android | Local source: folders of images, ZIP/CBZ, RAR/CBR, EPUB; "better performance with directories and ZIP/CBZ" [V mihon.app/docs/guides/local-source] | Paged LTR/RTL, vertical, webtoon; official FAQ says two-page side-by-side "Not currently" [V mihon.app/docs/faq/reader]; third-party says otherwise [S] | Brightness, color filter, e-ink opts, crop borders [S deepwiki/mihon]; tracking; per-series override |
| Komga | Server (Docker/JAR), web reader | CBZ, CBR (non-solid RAR only), EPUB, PDF [V komga.org, ultra.cc docs]; CBT mentioned [S] | Web reader: LTR, RTL, vertical, webtoon; double-pages option, but first/last/landscape pages always single [V komga.org/docs/guides/webreader-divina]; auto direction from metadata | OPDS 1.2 (v2 claimed [S]); Kobo sync claims conflict [U]; ComicInfo.xml; read progress; collections/read lists |
| Kavita | Server, web reader | CBZ/CBR/CB7/ZIP/RAR/7z, JPG/PNG/WebP/GIF/AVIF inside, EPUB, PDF [S] | Single, double (manga), webtoon; image splitting for joined spreads; LTR/RTL/up-down [S]; offset-spread is NOT supported ("built for comics", maintainer reply) [V github Kavita #2660] | OPDS (API key in URL); per-user reading profiles |
| YACReader (+Library) | Win/Mac/Linux, iOS, Android | CBR/CBZ/PDF etc. [S] | Desktop reader; iOS remote client | Library server (headless/Docker option), QR pairing, progress sync, image filters sync [V yacreader.com, ios.yacreader.com] |
| CDisplayEx | Windows, Android (Lite) | CBR/CBZ/PDF; archives ZIP/RAR/ACE/TAR/7Z/...; JPEG/GIF/PNG/BMP [S] | Dual page (D key) [S]; manga mode [U]; magnifier, bookmarks, color adjust [S]; no first-page separation per a comparison table [S cbz.fandom] | Classic; no WebP/AVIF listed |
| Perfect Viewer | Android | Comic archives + images | Auto single/dual/orientation-switch layouts; LTR/RTL; split two-page scans; fit modes; page caching [S] | Smooth filters (bilinear/bicubic/Lanczos3), brightness/contrast/gamma, auto white-border removal [S]; cover offset not found [U] |
| Panels | iOS/iPadOS/macOS | CBR, CBZ, CB7, PDF, comic EPUB, WebP [V panels.app/App Store] | Panel-by-panel view, vertical scroll, RTL, page animations; double-page option (paid tier [S]) | iCloud Drive, OPDS (Komga/Kavita) streaming, progress sync; paid features; review complaints: downloads broke, OPDS broke, search crash [S App Store] |
| Chunky | iOS/iPadOS | CBZ, CBR, PDF | -- | SMB, OPDS (IAP $3.99, only iPad reader with OPDS page streaming per Komga guide, dated) [V komga.org/docs/guides/chunky]; complaints: seemingly unmaintained, cloud integrations broken, OPDS settings deleted [S App Store] |
| Paperback / Aidoku | iOS | Aidoku: local CBZ/ZIP, ComicInfo.xml [V github Aidoku releases]; Paperback: unclear [U] | Source-extension model (Mihon-like) | Paperback availability unstable; 0.9 supporter-only TestFlight [S] |
| Yomu (manga) | iOS/iPadOS/Mac | Komga/Kavita/Jellyfin/OPDS + 19 sources [S] | Single, double, continuous [V komga.org/docs/guides/yomu] | Reviews mixed: paywall perception, ads, iPad local webtoon stutter [S] |
| KOReader | e-ink, Android, Linux | CBZ/CBR/CB7/PDF/EPUB | CBZ: no "dual pages" option [V KOReader #5799]; no RTL two-column [V #11085]; spreads zoom badly, advice is to preprocess with KCC [V #13826] | No ComicInfo.xml parsing [V #13787]; kosync progress protocol (MD5-hash doc id) is simple and self-hostable [S] |
| Kobo / Apple Books / Kindle | Devices | Kobo: CBZ/CBR basic, filename title, no metadata, slow engine [S mangaconverter.com]; Apple Books: EPUB/PDF only, no CBZ [S]; Kindle: needs KCC/Kindle Create | Kindle Guided View / Panel View auto-detects panels if borders clear [V kdp.amazon.com] | Panel detection is a differentiator but only on Amazon pipeline |
| MComix / HoneyView / Bandiview | Win (MComix GTK, cross) | MComix: CBR/CBZ/CB7/CBT/LHA/PDF; HoneyView: ZIP/RAR/7Z, WebP, PSD, RAW, APNG; Bandiview adds AVIF/HEIF, no resolution limit, webtoon mode (paid) [S] | Double-page, LTR/RTL (HoneyView), manga mode (MComix) [S] | HoneyView no longer updated [S]; JXL not mentioned |
| Cubari / MangaDex web | Web | Remote JSON/imgur only (Cubari hosts nothing) [V cubari.moe] | MangaDex: "offset double page spreads" per-chapter toggle [S forum/extension]; | Offset toggle is the UX to copy |
| Tachidesk / Suwayomi | Server (+web UI) | Runs Mihon extensions; local source: folders, ZIP/CBZ, RAR/CBR, EPUB [V github wiki Local-Source] | Web reader: vertical, paged, keyboard shortcuts [S] | OPDS feeds, library categories, downloads [V README] |
| Calibre viewer | Win/Mac/Linux | Comics via viewer/conversion | Not a comic-first reader | Reads ComicInfo.xml for sorting [S] |
| ComicRack (Community Ed.) | Windows | CBZ/CBR/CB7/CBT/PDF/DJVU | Dual page, RTL, saturation adjust [S] | Smart Lists, SQL library, steep learning curve [S] |
| Cover / Comic Screen | -- | -- | -- | No source retrieved [U] |

## 2. Features users expect (aggregated)

Formats: CBZ/ZIP, CBR/RAR (incl. RAR5, solid), CB7/7z, PDF, EPUB (fixed-layout), folders, WebP, AVIF, JXL, GIF.
Modes: single, double (with correct spread handling), continuous vertical (webtoon), RTL/LTR/vertical, auto direction from ComicInfo `Manga` tag.
Page handling: fit width/height/screen, zoom, pan, double-tap zoom, pinch, panel-by-panel (smart zoom), split wide pages, merge pages, crop borders/auto-trim.
Image: night mode, brightness/contrast/gamma, sharpen/upscale, e-ink mode, color filter.
Library: folders, series grouping, ComicInfo.xml, covers, progress, collections, search, duplicates, bookmarks, history.
Sync: self-hosted (Komga/Kavita OPDS, kosync-like), WebDAV, file sync (Syncthing).

## 3. Must-have / differentiator ranking

### Must-have (table stakes)
1. Fast open + page turn on huge CBZ/CBR/7z/folders (archive streaming, prefetch, bounded memory).
2. Correct RTL/LTR + double-page pairing with cover-offset toggle, per-series memory, and wide-page auto-single.
3. Webtoon continuous mode that survives tall images and iPad memory limits.
4. Reading progress, history, bookmarks, resume; ComicInfo.xml (series, number, volume, Manga/RTL) and cover thumbnails.
5. Library with folders/series grouping, search, sort, duplicate hint.
6. Pinch/double-tap zoom, pan, fit modes, keyboard + touch zones + gamepad-friendly nav.
7. Night/e-ink-friendly modes, brightness/contrast, crop borders.
8. Local-first with offline operation on all three platforms.

### Differentiators (where existing apps fail)
1. One consistent spread engine: automatic detection of spreads (landscape page = single; cover detection; "offset pairing" slider; manual per-page override persisted) - Komga/Kavita/Mihon all weak here.
2. Cross-device progress sync with no cloud: small self-hosted/LAN sync service or WebDAV/kosync-compatible endpoint, plus library file transfer.
3. Smart panel-by-panel guided view (local ML or heuristic) - only Panels and Kindle do it.
4. High-quality offline upscaling/sharpening (WebGL/WebGPU shaders) and auto-trim of margins.
5. First-class WebP/AVIF/JXL, solid RAR/7z, nested zip, corrupted-archive tolerance.
6. Reliable library import that never loses data (no "downloads vanished" bugs); portable plain-file library.
7. Polished UI: gestures, haptics, page-curl, iPad split-view and Stage Manager, Windows touch/pen, accessibility (VoiceOver, large targets, reduced motion).

## 4. Pitfalls from complaints (with sources)

| Pitfall | Source |
|---|---|
| Large local CBZ on low-RAM device OOMs; extracting to folder avoids it | https://github.com/mihonapp/mihon/issues/1973 |
| Native crash opening very large local CBZ pages on Android 15 | https://github.com/mihonapp/mihon/issues (issue #4070, opened Oct 2026; seen only in search summary [S]) |
| Slow load of offline CBZ; slow disk lookups with ~1000 chapters (10 s freezes) | https://github.com/mihonapp/mihon/issues/735 , https://github.com/mihonapp/mihon/issues/705 |
| Page transition lag / lag with long chapters | https://github.com/mihonapp/mihon/issues/700 , /736 |
| Disabling split-wide-pages jumps page index wrongly | https://github.com/mihonapp/mihon/issues/2191 |
| Two-page spread support long-requested, closed duplicates | https://github.com/mihonapp/mihon/issues/28 , /2399 |
| Kavita: no spread offset; scanlated chapters without cover break all pairings | https://github.com/Kareadita/Kavita/discussions/2660 |
| Kavita double-page extremely zoomed on iPad Safari, left page cut | https://github.com/Kareadita/Kavita/issues/3056 |
| Kavita RTL double mode wrong page order | https://github.com/Kareadita/Kavita/issues/3095 |
| Kavita: iPadOS Safari reopen detects insufficient space for double layout; original-resolution images with image splitting; webtoon image artifacts on Firefox mobile | https://github.com/Kareadita/Kavita/issues (#4926, #4922, #4865 [S, titles only]) |
| Kavita webtoon: very tall/high-res images overflow | https://github.com/Kareadita/Kavita/issues/667 |
| Komga: double-page mode always shows first/last/landscape single; centers lone pages | https://komga.org/docs/guides/webreader-divina/ , https://github.com/gotson/komga/issues/670 |
| Komga CBR: solid RAR unsupported | https://docs.ultra.cc/applications/komga |
| KOReader: no CBZ dual page, no RTL two-col, poor spread zoom, no ComicInfo | https://github.com/koreader/koreader/issues/5799 , /11085 , /13826 , /13787 |
| Kobo CBZ: filename-only titles, shrunk, slow engine; Apple Books no CBZ | https://www.mangaconverter.com/blog/does-kobo-support-cbz |
| Chunky: unmaintained, cloud integrations broken, files disappear, OPDS settings deleted | https://apps.apple.com (reviews, via search summary [S]) |
| Panels: Downloads section broke after 75 GB, OPDS stopped, search crash, paywalled page-curl | https://apps.apple.com/us/app/panels-comic-reader/id1236567663?see-all=reviews |
| Yomu: paywall complaints, ads, iPad webtoon stutter on local files | https://apps.apple.com/us/app/yomu-manga-webtoon-reader/id6760745234 |
| MangaDex reader: switching double/single shifts page index | https://forums.mangadex.org/threads/mainsite-returning-to-single-page-view-after-viewing-a-double-page-with-offset-displays-wrong-page.1183102/ |
| iOS Safari canvas limits (16,777,216 px area; ~224-384 MB total canvas memory, device-dependent; silent blank) | https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ , https://developer.apple.com/forums/thread/112218 |
| Syncthing on iOS impossible officially; Mobius Sync background timing controlled by iOS (unpredictable) | https://mobiussync.com/faq/ |

Design lessons: never decode whole archive into RAM; cap decoded bitmap area; separate page-index from displayed-spread index (the root of several off-by-one bugs); persist spread overrides; never hide core features behind paywalls (not relevant for a personal app, but a complaint pattern).

## 5. Technical routes

### 5.1 PWA
- iOS Safari does not support the File System Access pickers (`showDirectoryPicker` etc.) on any iOS/iPadOS version [V per MacRumors/MDN/Chrome docs search summaries]. Files must come from `<input type=file>` / share sheet / drag-drop, then be copied into app storage.
- OPFS is available in Safari 15.2+ iOS [V webkit.org/blog/12257]; it is the right place to store imported archives (sync access handles in workers). Not available in Private Browsing.
- Storage eviction: ITP deletes script-writable storage (IndexedDB, SW registrations/caches) after 7 days of non-interaction, BUT home-screen web apps are exempt and have their own use counter [V webkit.org/tracking-prevention]. Whether OPFS is covered identically: treated as "same lifetime as IndexedDB" [V WebKit blog]. Quota numbers for Safari/PWA: not verified [U]; test on device. `navigator.storage.persist()` behaviour on Safari: [U].
- Windows/Android Chrome/Edge: File System Access API works, enabling direct folder library without copying (a real advantage on Windows).
- Image decoding in Safari: WebP and AVIF (Safari 16+) fine; JPEG XL shipped in Safari 17 [S cloudinary, openreplay]; Chrome JXL still behind flag [S]. So on Windows/Chromium, JXL needs a WASM decoder (jxl-wasm/libjxl) [U for specific lib state]. `createImageBitmap` behaviour per format on Safari: not verified [U]; prefer `<img>.decode()` / `createImageBitmap` with fallback.
- WASM archives: libarchive.js (ZIP, 7z, RAR v4/v5, TAR; v2.0.2 last published ~3 years ago) [S npm/github]; libarchive-wasm 1.2.0 (low-level API, about 1 year old) [S]; archive-wasm (HeavenVolkoff) [S]. RAR5 and solid-RAR performance claims are from READMEs only; benchmark with real solid CBR. WASM archives generally require reading whole file into memory unless a streaming wrapper (OPFS sync access handle) is used - risk for multi-GB archives on iPad [U, design inference].
- Memory: iOS Safari canvas caps (see pitfalls). Use `<img>`/ImageBitmap with downscale-on-decode, tile tall webtoon strips, release bitmaps via `close()`.

### 5.2 Wrappers
- Capacitor: web app + WKWebView; mature mobile plugin ecosystem (filesystem, share target, file picker) [S oflight.co.jp]. Gives native file access (Files app, security-scoped URLs) that PWA lacks; same WebView memory limits though.
- Tauri 2: desktop excellent; mobile newer, fewer plugins, rougher debugging; sources conflict about production-readiness [S]. Official fs/store plugins have mobile implementations [S]. Rust side could host fast archive/RAR/7z/JXL decoding natively on all platforms, which is a strong fit for archive performance.
- Flutter: most consistent mobile+desktop, own rendering engine (no WebView memory issue), good image/gesture control; archive decode needs FFI/Dart packages (RAR is weak in pure Dart; would need libarchive via FFI) [S/U].
- React Native: mature mobile; Windows support via RN-Windows exists but ecosystem weaker [U].

### 5.3 Sync without a cloud
- Syncthing: no official iOS client; third-party Mobius Sync/Synctrain are limited by iOS background rules [V mobiussync FAQ; S t-shaped.nl].
- WebDAV: simple, supported by many iOS apps; works as library source + progress file (JSON) store. Reader apps like Chunky/Panels use SMB/OPDS/iCloud instead. WebDAV-in-browser needs CORS config on server [U].
- kosync-compatible endpoint: documented REST (PUT /syncs/progress, GET /syncs/progress/:doc, MD5 doc hash), many open-source servers [S]; progress units are reader-specific (pages left vs percentage) [S].
- Komga/Kavita OPDS as source: OPDS page streaming extension (PSE) lets clients read without downloading [S Panels, V Chunky guide]. Komga/Kavita as optional backend gives library+progress for free but adds a server dependency.
- LAN server option: small local server (Windows tray/Tauri sidecar) exposing OPDS-like catalog + progress + file range requests; iPad/phone PWA over Tailscale/LAN. (Design proposal, not a verified product.)

## 6. Recommended architecture

**Core idea: one TypeScript/web codebase for UI + reader engine, shipped three ways, with a thin native layer only where the web platform is weak.**

1. Reader engine (shared, TS + WASM): archive layer (zip.js for ZIP streaming; libarchive WASM for RAR/7z; native fallback via plugin), image pipeline (decode in worker, downscale to viewport, LRU of N bitmaps, prefetch +/-3 pages, tile webtoon strips under the 16.7 MP canvas cap), spread engine (page-index vs spread-index separation, auto-single for landscape, cover-offset toggle persisted per series, manual per-page override), filters via WebGL (night, contrast, sharpen, crop borders).
2. Packaging:
   - **Windows:** Tauri 2 (or the PWA in Edge) with File System Access / native fs; optional Rust sidecar for RAR/7z/JXL decoding and the LAN sync server.
   - **iPad/iPhone:** Capacitor shell (Files-app import, security-scoped bookmarks, share-target "Open in") around the same web code; fall back to plain installed PWA if native access is not needed. Store imported books in app sandbox/OPFS.
   - **Android:** same Capacitor shell or PWA.
   - Why not Flutter/RN: forces rewrite of the reader engine in a second stack for one owner; reconsider only if WebView memory/perf on iPad proves unacceptable in a prototype.
3. Library: SQLite (wa-sqlite on OPFS or native plugin) storing series, ComicInfo.xml fields, progress, bookmarks, spread overrides; covers cached as WebP thumbnails.
4. Sync: progress/bookmarks/overrides as an append-only JSON event log synced via WebDAV (default) or the owner's LAN/Tailscale sidecar; optional OPDS client for Komga/Kavita. File transfer: user's own WebDAV/SMB/Files app. No accounts.
5. Staged plan: (a) PWA prototype with ZIP/CBZ + spread engine + webtoon, test on real iPad; (b) add RAR/7z WASM and benchmark; (c) Capacitor/Tauri wrappers; (d) sync; (e) panel-guided view and upscaling.

### Risks
- iOS WebView/Safari memory limits on huge pages and large archives (mitigate: tiling, streaming from OPFS, native decode plugin fallback).
- WASM RAR/7z maintenance risk (libarchive.js stale for ~3 years) and solid-archive speed; mitigation: Rust/native decoder behind the same interface.
- iOS storage eviction/quota unknowns for PWAs; mitigation: Capacitor sandbox storage plus export/backup.
- Tauri 2 mobile maturity disputed; keep it desktop-only initially.
- Panel detection quality (needs ML or heuristics; scope risk).
- JXL support inconsistent outside Safari; need WASM decoder.
- No Reddit evidence gathered; complaint ranking is based on GitHub/App Store signals - re-run with Aside when it responds.

## 7. Open questions to verify next
- Safari OPFS quota and `persist()` behaviour in installed PWAs on current iOS.
- Real-world speed of libarchive.js on solid RAR5 and 2 GB CBZ on iPad.
- Whether Komga's Kobo sync exists (sources conflict) and Mihon's current spread support (docs say no; GitHub #3812 "Dual page support" title only).
- Cover/Comic Screen identity, Perfect Viewer cover-offset, Bandiview JXL.
