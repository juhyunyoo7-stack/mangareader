# STATUS (MVP + phase 2/3 formats and reading features, not deployed)

Last full `npm run check` (typecheck, prettier, unit, build, e2e): green on 2026-10-13 after the last change (286 unit, 75 e2e passed, 84 skipped: WebKit storage specs plus the opt-in real-file specs).

## 2026-11-05: loose images and folders import, port diagnosis, phone guide

Latest full `PW_PORT=15173 npm run check`: green, 78 e2e passed, 87 skipped (same skip classes as before), unit tests incl. 11 new ones.

| Item | What was done and verified |
| --- | --- |
| Loose page images (owner's main use: downloaded image files) | Before: the picker rejected anything but zip/rar/7z/pdf ("unsupported"), so loose JPG/PNG files could not be read. Now `src/data/imageBundle.ts` streams selected images into a stored CBZ (fflate `Zip`+`ZipPassThrough`, 1 MB slices) and feeds it to the normal import. One book per selection, or per folder with "Import image folder" (`webkitdirectory`). Pages follow natural file-name order (2 before 10). Book title = folder name, else the common file-name prefix, else "Images <date>". Verified: 11 unit tests (order, naming, byte-identical read-back via ZipReader, >1 MB image, archives pass through) and 3 e2e (4 loose PNGs -> 1 book with 4 pages, folder input -> book named after the folder, same images twice -> duplicate toast, 1 card). |
| Two bugs found by those tests and fixed | (1) `webkitdirectory=""` is a boolean property in Preact, so the folder picker silently did nothing; now `{true}`. (2) The CBZ entries carried the current time, so re-importing the same images 2+ seconds later produced different bytes and no duplicate detection; entry time is now fixed (1980-01-01), unit test waits 2.1 s to prove it. |
| Port 4173 / EACCES | On this PC Windows reserved 4113-4212 (excluded port range), so `npm run check` failed with `listen EACCES ::1:4173` and the desktop launcher could not start either (`WinError 10013`). Tests: `PW_PORT` env overrides the e2e port (default stays 4173). Launcher port is NOT changed on purpose: the library lives at origin `localhost:4173`. Launcher: http.sys reports error 32 for both busy and reserved ports, so on failure it now probes with a plain socket (AccessDenied = reserved by Windows, otherwise busy) and shows a precise Korean message pointing to `docs/PORT.md`. Verified by launching the rebuilt exe in the blocked state and reading the dialog text. The old Windows C# 5 compiler rejects `catch ... when`, so the code uses a plain catch. |
| Desktop exe | Rebuilt (`scripts/build-exe.cmd`): `releasepp` equals `dist` (diff clean) and contains the folder import. Not run end to end on a free port in this session because 4173 is blocked until Windows frees it (reboot) or `docs/PORT.md` step 2 is applied by the owner (admin). |
| Phone | `docs/PHONE.md`: app is subpath-ready (`base './'`, relative manifest); phone needs HTTPS. Public deploy NOT done (standing agreement: report before push). No real phone was available, so iOS/Android behaviour is untested; the picker already has no `accept` filter for iOS. |
| Not verified / not done | No real comic files exist on this PC (E: unplugged, no cbz/cbr found), so real RAR/PDF/EPUB still untested. Not started: duplicate/collections UI (T28), controls customisation (T27), app lock (T29), guided-view accuracy. Dropping a folder of images onto the window still goes to the "library folder" path (archives only); picking the folder with the button works. `launcher/Launcher.cs` also carries an earlier uncommitted `--disable-extensions` change that was in the working tree before this session. |

## 2026-11-01: folder move check, desktop launcher, icon, trim, guided label

Latest full `npm run check` (after all changes below): green, 289 unit (14 files), 75 e2e passed, 84 skipped (same skips as before: WebKit storage specs + opt-in real/screenshot specs).

| Item | What was done and verified |
| --- | --- |
| Folder move (`개발프로그램\MangaReader` -> `개발프로그램\3_영상·미디어\MangaReader`) | `npm ci` and the full check run green from the new path before any change (286 unit, 75 e2e, 84 skipped). No absolute project paths in configs/scripts; no Korean-path problem found. The only broken path was the real-file folder: the scans moved to `E:\만화책\소년탐정 김전일`; `real.spec.ts` now defaults there (`REAL_DIR` overrides). |
| Real-file test | `REAL=1 ... real` 7/7 passed from E: (import of vols 10+01+20, 62 MB: 2.0 s; open 91 ms; page-turn median 9 ms, p90 15 ms; cache 177 MB, heap 10 MB; resume OK; series RTL inherited). Drive E: was unplugged later in the session, so the final re-run with the new trim code was done numerically only (next row). |
| Auto-trim vs dark scanner borders | `contentBox` now strips a dark band at a side only when it ends within 4% of the side **and** blank paper follows; if art or a panel frame touches the paper edge after the band, that side is not cropped. Dark margins keep a 3 px (at 512 px) pad so a black panel frame next to a black margin is not cut. Guard unit tests (dark border + art touching each paper edge, full-bleed art, dark art at the image edge) fail on the old code and pass now. Real scans, measured with the same function on 512 px luminance in Node (no images viewed): vol 10 0/89 cropped (old 0), vol 01 5/91 (identical to old, removed area 100% light paper), vol 20 5/92 (old 4; all removed areas 100% dark margin, slightly less removed than before because of the pad). Only 1 of 272 pages had a scanner band followed by paper: on these scans the art reaches the paper edge, so trimming the 1-6 px dark edge would cut art and is deliberately not done. Net effect on these files: practically none, but no damage. |
| Guided view | Visible "실험 기능" badge in reader settings, honest hint, toast says experimental, default off (unchanged). `panels.ts` not changed: improving it needs hand-annotated ground truth on the owner's copyrighted spreads, which was not done, so no measured improvement is claimed (still 0/10 fully correct). |
| Desktop launcher | See `launcher/BUILD.md`. Fixed: the single-instance mutex was garbage-collected, so a second start showed a false "port 4173 busy" dialog (reproduced with the shipped exe). Now: second start focuses the open window; busy port -> clear Korean message (tested with another server on 0.0.0.0:4173 and on 127.0.0.1:4173), exit without starting the browser; window size remembered (resized 900x700 kept after reopen); `no-cache` for shell/SW; non-local requests refused. Rebuilt with `scripts/build-exe.cmd`. Tested with a separate test profile (`MANGAREADER_PROFILE`) and CDP (`MANGAREADER_DEBUG_PORT`): started from `C:\` and from the Desktop shortcut, all 21 served files identical to `dist`, library shows, `basic-10.cbz` imports (0.24 s) and opens, next page works, closing the window ends the launcher in about 4-5 s with no browser process left and port 4173 free. |
| Icon | `launcher/MangaReader.ico` (6 sizes, embedded in the exe: 1 RT_GROUP_ICON, 6 RT_ICON), PWA icons replaced (192/512/maskable). Made from a local Stable Diffusion render plus a drawn panel grid (details in `launcher/BUILD.md`). |
| Desktop shortcut | `C:\Users\strag\Desktop\만화 리더.lnk` -> `release\MangaReader.exe`, working dir `release`, icon `release\MangaReader.ico`. Read back and launched successfully. |
| Large archive | Synthetic 84 MB CBZ (48 noisy 1400x2000 JPEG pages, stored): import 0.34 s, open immediate, 47 page turns fine, page cache 110 MB (budget 800 MB, 0 evictions), JS heap 10 MB, no page errors. Once, `+` right after 47 rapid turns to the last page left zoom at 1.00; not reproduced on a second try (zoom 1.96 mid-book, 1.40/1.96 on the last page). |

Not verified in this round: second-start focus when a system dialog ("Windows 보안" / PickerHost) is in front (Windows refused focus in 10 tries; it worked once when no such dialog was open); owner's real profile was never used in tests (no test data was added to it); real compressed/solid RAR, real PDFs/EPUBs, iOS/Android devices (unchanged from below); a real 60+ MB scanned CBZ (only the synthetic one).

**Resume here (2026-11-01):** (1) guided view accuracy only with annotated ground truth (counts per real spread in `tests/fixtures/real-annotations.json`); (2) real CBR/PDF/EPUB files; (3) items under "Resume here" at the end.

## Task completion (DESIGN.md section 15)

| Task                                                                       | State                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| T1-T13 scaffold, PWA, engine, import, readers, zoom, library, webtoon, overlay | done (see test counts)                                                                                 |
| T14 Desktop FSA library                                                    | done; e2e `fsa.spec.ts` uses a mock `showDirectoryPicker` over OPFS (add, Settings list, rescan, remove). Real File System Access permission prompts (Reconnect after browser restart) are not covered. |
| T15 Export/import state                                                    | done: `src/data/backup.ts` (export, download, validated import, pending state applied on later book import, 14-day reminder banner), Settings buttons; unit + two-context e2e |
| T16 Storage mgmt                                                           | done: Settings screen (storage meter, offload finished, erase-all with two confirmations); e2e offload/re-attach and erase-all |
| T17 Android share target                                                   | done; `handleShare` unit-tested (field filtering, 50 file cap, name sanitising). Real Android share sheet unverified. |

## Phase 2/3 tasks (DESIGN section 15, implemented 2026-10-13, in this order)

| Task | State | What is verified / what is not |
| --- | --- | --- |
| T20 RAR/CBR + 7z/CB7 | done with gaps | `libarchive-wasm` 1.2.0 (MIT; `archive-wasm` rejected: GPL-3). Lazy chunk + 613 KB wasm asset, precached by the SW. Verified: real 7-Zip output (solid and non-solid), encrypted 7z (and encrypted-header 7z) rejected, RAR4 and RAR5 **stored-method** archives (hand-written fixtures, `scripts/fixtures/rarwriter.ts`), traversal/hidden names dropped, damaged file -> typed error, over-limit and WASM-load failure -> "convert to CBZ" message, import + open + page pixels in Chromium. **Not verified: compressed or solid RAR (no RAR compressor on this PC), the owner's real CBR, performance on large archives.** No benchmark between WASM libraries was run (one library chosen on licence/size). Entries are decoded once into memory and held (bounded by `wholeArchiveLimit` for the archive and for the decoded total); extraction into OPFS (DESIGN 6) and the desktop "Convert to CBZ" write action are **not** implemented, only the message. |
| T21 PDF | done with gaps | `pdfjs-dist` 6.4.299, lazy chunk, parser run in our decode worker (no nested worker), OffscreenCanvas via custom canvas factory, `disableFontFace`. Verified: generated 4-page vector PDF (portrait + landscape page): dimensions, wide-page detection, import, cover, page colours, tiles path compiles. **Not verified: scanned/image PDFs, JBIG2/JPX, encrypted PDF (mapped to the "password-protected" message but never exercised), non-embedded fonts (no font data shipped), very large PDFs (whole file read into memory, limit = `wholeArchiveLimit`).** |
| T22 image EPUB | done with gaps | Spine order, `<img>`/`<svg><image>` pages, `page-progression-direction=rtl` -> RTL, `dc:title`, text EPUB rejected (>30% of spine items without image or with >200 chars of text). Parsing is regex-based (workers have no DOMParser). Verified on synthetic EPUB 3 fixtures only; **no real-world EPUB was tried**; pages drawn as CSS background images are not supported. |
| T24 JXL / AVIF | done with gaps | Browser decoder tried first per format; on failure `@jsquash/jxl` 1.3.0 / `@jsquash/avif` 2.1.1 (Apache-2.0, lazy) decode and the page is re-encoded as PNG for the normal path. Verified in Chromium with real AVIF/JXL encodes, both normally and with the WASM path forced (`?wasmimg=1`, asserts the decoders were fetched). **WebKit/iOS not run** (storage specs skip on WebKit here), so the DESIGN acceptance "chromium and webkit" is only half met. |
| T19 image filters | done | CSS presets Off/Night/Sepia/E-ink + brightness/contrast sliders (per book or series, kept in backups), paged and webtoon. The optional WebGL sharpen pass is **not** implemented. |
| T19 auto-trim | done, paged only | `core/trim.ts` (unit tests: margins within 2 px at 512 px, specks ignored), union crop across a spread, detail tiles offset by the crop (e2e mutation-checked). **Not applied in webtoon mode.** Analyses are cached in memory per reader session, not in the IndexedDB `pageCache` store. Real scans: no effect (0/89 pages cropped, see Real-file test). |
| T25 guided view | done, synthetic accuracy only | `core/panels.ts` (X-Y cut, 512 px luminance), reading order LTR/RTL, camera with 4% padding, 250 ms tween (instant under reduced motion), taps/arrow keys step through panels then pages, `g` toggles, forced single-page layout while on. 10 generated grid cases pass (target >= 80%). **Real-manga accuracy measured on 10 real pages: 0 fully correct, 4 fall back to the whole page, the rest merge several panels into one block (see Real-file test).** Keyboard panning is disabled while guided (drag still pans). |

Not started from phase 3: T26 auto-offset suggestion, T27 controls customisation/gamepad, T28 collections UI/duplicates, T29 app lock.

## Polish round (2026-10-13, stopped early by the shared-quota gate)

| Task | State |
| --- | --- |
| (3) Korean UI | **Done, check green.** All views, toasts, import/scan/error messages live in `src/i18n/` (`en.ts` defines the keys, `ko.ts` is the default, `index.ts` picks the locale; `src/strings.ts` re-exports `S`). Language selector in Settings (reloads). To add a language: create `src/i18n/<code>.ts` exporting a `Dict`, register it in `LOCALES` and `LOCALE_NAMES` in `index.ts`; the compiler lists missing keys. e2e specs run with the English locale (fixture option `uiLocale`, default `en`), `tests/e2e/korean.spec.ts` runs in Korean and checks Korean content plus horizontal overflow / clipped text on phone 412x915, iPad 820x1180 and desktop 1280x800 (no problems found by those heuristics; screenshots `docs/screenshots/ko-*.png` looked fine to me: no mid-word breaks, nothing cut off). Bug found and fixed on the way: the settings sheet derived group ids with `\W`, so every Korean label produced the same id. Not covered: iOS/Android real devices, `archive`/`core` internal developer strings (not user-visible). |
| (1a) Night filter | **Done, check green.** `Night` replaced by `Dim` (`brightness(.64) sepia(.2) contrast(1.06)`, reads well on the real grey scans: soft warm paper, ink intact) and `Invert-soft` (invert + hue-rotate + contrast .55 + brightness 1.35, background about 30% grey, not black). Honest limit: in Invert-soft faces still come out dark because paper and faces are both white in these scans and a global filter cannot separate them; Dim is the one to recommend. Old stored `night` maps to `invert-soft`. Compared 7 candidate curves visually on real page 3 and the cover. |
| (1b) Auto-trim vs dark scanner borders | **Done 2026-11-01 (conservative).** See the 2026-11-01 section. |
| (2) Guided panel accuracy + annotations + experimental flag | **Label done 2026-11-01, algorithm unchanged.** Visible 실험 기능 badge, honest hint, toast says experimental, still off by default. Accuracy not improved (see 2026-11-01 section). |

**Old resume note (superseded by the 2026-11-01 section):** (1b) start in `src/core/trim.ts` `contentBox`: estimate the border colour from the outer band, treat a uniform dark band as border, then crop paper margins conservatively; add guard tests that panel content is never cropped (synthetic pages with a dark border and inked art touching the paper edge) and REAL=1 counts for vols 10/01/20. Then (2): annotate the 10 spreads into `tests/fixtures/real-annotations.json` (counts only) and improve `src/core/panels.ts`; per-page overlay helper `drawPanels` is in `tests/e2e/real.spec.ts`.

## Real-file test (owner's Kindaichi volumes 01, 10, 20, 2026-10-13)

Run with `REAL=1 npx playwright test real --project=chromium-desktop` (default folder `E:/만화책/소년탐정 김전일` since 2026-11, override with `REAL_DIR`; files are read in place, nothing is copied into the repo). The screenshots in `docs/screenshots/real-*.png` are copyrighted personal scans for local review only: **never publish them** (they are listed in `.gitignore`; `docs/` is also outside prettier).

| Check | Result (measured on this PC, Chromium 1280x800, preview build) |
| --- | --- |
| Import (file input -> OPFS) | vol 10 (16.0 MB): 0.33 s; vols 10+01+20 (62 MB) in one batch: 0.85 s. All three imported, no crash. |
| Entry names | Vol 10: CP949 names without UTF-8 flag decode correctly (`_cover.jpg` + `김전일10_01..88.jpg`); vol 20: `Jun1-소년탐정_김전일_20권_001..093.jpg` decoded; vol 01: ASCII `Kindaichi01-00..94.JPG`. Order is natural-numeric in all three (vol 10 pages 0..88 = cover, 01..88). Page count: vol 10 = 89 entries (cover + 88), 01 = 91, 20 = 92. |
| Cover | `_cover.jpg` (495x715) is a real, distinct front cover, not a duplicate of page 01 (first interior page is a 990x728 spread). Kept as page 0, shown alone; used as the library cover (checked in `real-library.png`). The last page (495x749) is a single page (back cover). |
| Page shape | 87 of 89 pages are **already merged two-page spreads** (about 990x740, landscape, flagged wide), so the double-page pairing never pairs two files: every spread is shown alone; cover and back cover alone. Layout auto = "double" at 1280x800, which is right for these files. |
| Reading direction | No ComicInfo, so default LTR. Reading three consecutive spreads (p1, p2, p3) in order shows the story runs **left page -> right page**: this Korean edition is printed mirrored (left-to-right), so LTR is the correct default for these files, RTL would be wrong. Per-series RTL works when wanted: "Whole series" + Right to left on vol 10 is inherited by vol 20 (e2e-verified). A global default direction exists in Settings > Reading defaults. No automatic RTL detection exists (nothing in these files says Japanese); that remains a manual choice. |
| Open time | click on the book -> reader ready: 93 ms (vol 10). |
| Page-turn latency | key press -> next animation frame with the new page on screen: median 6 ms, p90 15 ms, max 16 ms over 30 turns (180 ms apart, prefetch warm); idle turns 1-17 ms. A never-seen page decodes in 4-5 ms in the worker. 20 turns 30 ms apart settle on the right page in 1.5 s with no pile-up. |
| Memory | after about 90 page views: page cache 177 MB (61 entries, budget 800 MB, 0 evictions), main-thread JS heap 10 MB, 1 live canvas. Worker memory not measured. |
| Zoom / pan | 3x zoom (2.74) on a spread, arrow-key pan to the gutter: smooth; text stays readable but soft because the source is only ~495 px per page (inherent to the scans, not the viewer). |
| Resume | page 30 -> reload -> back on page 30. |
| Filters | E-ink and Sepia look right (the paper is yellowed, E-ink removes it). **Night is a harsh negative**: skin and white areas turn near-black silhouettes (invert + hue-rotate on grey scans); readable but not pleasant. Not changed. |
| Auto-trim | **No effect on these files: 0 of 89 pages cropped.** The scanner border is dark with soft shading, so the border colour does not separate it from the page. The scans only have 1-3% border, so little would be gained. Not changed. |
| Guided view (g) | See below. The keyboard walk on spread p1 works end to end (6 panels, then next page). |

Panel detection on 10 real spreads (p1,2,3,10,20,30,45,60,75,87; annotated screenshots `real-v10-panels-p*.png`, checked by eye): **0 of 10 pages are fully correct.** What it does: the first run found nothing on any page (the page border ring is black, so white gutters counted as content). Fixes made from that: gutter colour chosen between border colour and the light paper peak, a 1.5% edge/spine band ignored, spreads cut at the centre and each page analysed on its own with the first page read before the second (RTL books read the right page first), finer gutter thresholds. Result now: p1 right page 5/5 panels correct and the left page merged into one; p45 and p60 left pages correct (5 panels) but the right page merged into one block; p3, p10, p87 give 3-5 blocks where there are 8-10 panels (blocks of several panels merged); p2, p20, p30, p75 (4 pages) fall back to the whole spread (crowded or diagonal layouts). So detection under-segments: it finds bands/blocks, not individual panels, whenever frames are diagonal, overlapping or the gutters are thin. It degrades safely (a merged block is still a zoomed view, a fallback is the whole page) but is **not reliable on real manga**; treat guided view as experimental.

## Fixed after the first phase 2/3 round

- Rapid successive preference changes lost one (e.g. `r` then `g`): `applyPref` read the book, awaited the IndexedDB write and only then published the result, so overlapping calls started from the same old prefs and toggles computed from stale state. Now the in-memory book/series are updated synchronously and the writes go through one queue (`tests/e2e/prefs-race.spec.ts`; both tests failed before the fix).
- Escape did not close the settings sheet when pressed right after it appeared: the Escape listener was registered in `useEffect` (after paint), so a key in that gap was lost (a slider `fill` in e2e, or any key while the main thread is busy decoding). Now registered in `useLayoutEffect` (`tests/e2e/sheet.spec.ts`; failed 3/3 before).
- ZIP names without the UTF-8 flag are decoded with one code page per archive (EUC-KR / Shift-JIS / windows-1252) instead of per entry, because per-entry trial order picked Shift-JIS for Korean names that are also valid Shift-JIS (e.g. the bytes of "김일"). Unit tests with a CP949 fixture (`cp949.cbz`) and the real files.

## Test status

- Unit (Vitest): 286 passing, 14 files.
- E2E: 75 passing, 84 skipped (WebKit storage specs; `real.spec.ts` needs `REAL=1`). Chromium desktop, Chromium phone (Pixel 7 touch).
- WebKit: smoke + offline only. Playwright WebKit on Windows has no working OPFS writes, so storage specs skip there. Real iOS Safari unverified.
- `SHOTS=1 npx playwright test screenshots --project=chromium-desktop` regenerates `docs/screenshots/` (desktop 1280x800, iPad 820x1180, phone 412x915: library, empty library, settings, single page, overlay, RTL double page, webtoon). It is skipped without SHOTS.

## UI review (screenshots)

Reviewed all three viewports. Fixed: import progress panel stayed open after success and covered the library and Settings on phones (now clears itself 4 s after an all-success batch; failures stay); storage meter was squeezed into a narrow column inside Settings rows. RTL double page order verified visually (higher index on the left, mirrored digits are correct glyphs). Webtoon and paged views look fine at all sizes; double page on a portrait phone is small but works (user-forced layout).

## Not done / unverified

- Real iOS/Android devices untested (all DESIGN 16.2 items). Not deployed.
- Collections have no UI (they are exported/merged in the state file but import ignores them).
- Series preferences import only applies to a series that has no preferences yet (series records carry no updatedAt).
- ESLint omitted on purpose (tsc strict + noUnused*, prettier). No vite-plugin-pwa (own esbuild SW plugin).
- AdGuard on the dev PC rewrites the CSP meta in local tests.

## Resume here

1. Real-device pass on iOS (home-screen install, OPFS import, backup reminder) and Android (share target, install).
2. Verify T20/T21/T22 on the owner's real files (compressed/solid CBR, scanned PDF, real EPUB) and try guided view on real manga pages.
3. Korean UI: extend `src/strings.ts` to all views, then update e2e selectors.
4. Remaining phase 3 tasks T26-T29, then deploy (not started; owner decision).
