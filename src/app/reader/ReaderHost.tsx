import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyPrefPatch, effectivePrefs, type PrefScope } from '../../core/prefs.ts';
import type { Book, PageOverride, Progress, ReaderPrefs, Series } from '../../core/types.ts';
import { handlePermission, resolveBookSource, SourceError } from '../../data/bookSource.ts';
import { getDb } from '../../data/db.ts';
import {
  addBookmark,
  booksOfSeries,
  getBook,
  getDeviceId,
  getProgress,
  getSeries,
  getSetting,
  listBookmarks,
  patchBook,
  putSeries,
  removeBookmark,
  saveProgress,
  setSetting,
} from '../../data/repo.ts';
import { DecodeClient } from '../../engine/DecodeClient.ts';
import { Reader } from '../../engine/Reader.ts';
import type { ReaderConfig } from '../../engine/types.ts';
import type { KeyCommand } from '../../engine/controls.ts';
import { leave, replaceRoute } from '../router.ts';
import { bumpLibrary, globalPrefs, pushToast, uiSettings } from '../store.ts';
import { Sheet } from '../components/Sheet.tsx';
import { Overlay } from './Overlay.tsx';
import { QuickSettings } from './QuickSettings.tsx';
import { isDebug } from '../../engine/Reader.ts';
import { keepScreenOn } from '../../platform/web.ts';
import { S } from '../../strings.ts';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; source?: SourceError['kind'] }
  | { kind: 'ready' };

const SAVE_DEBOUNCE_MS = 500;

const layoutName = (l: string) =>
  l === 'single'
    ? S.layoutSingle
    : l === 'double'
      ? S.layoutDouble
      : l === 'auto'
        ? S.layoutAuto
        : S.layoutWebtoon;

export function ReaderHost({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [book, setBook] = useState<Book | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [thumbs, setThumbs] = useState(false);
  const [quick, setQuick] = useState(false);
  const [page, setPage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [bookmarked, setBookmarked] = useState<string | null>(null);
  const [pageMenu, setPageMenu] = useState<{ page: number } | null>(null);
  const [scope, setScope] = useState<PrefScope>('book');
  const scopeRef = useRef<PrefScope>('book');
  const [finishedPrompt, setFinishedPrompt] = useState(false);
  const [nextBook, setNextBook] = useState<Book | null>(null);
  const [announce, setAnnounce] = useState('');
  const [debugText, setDebugText] = useState('');
  const state = useRef({ book: null as Book | null, series: null as Series | null, page: 0 });
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<{ page: number; offset?: number } | null>(null);
  const lastAnnounce = useRef(0);
  const finishedShown = useRef(false);

  // ---- progress persistence -----------------------------------------------------------------
  const flushProgress = async () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pending.current;
    const b = state.current.book;
    pending.current = null;
    if (!p || !b) return;
    await saveProgress(b, p.page, p.offset, await getDeviceId());
  };

  const config = (b: Book, s: Series | null): ReaderConfig => {
    const eff = effectivePrefs(globalPrefs.value, s?.prefs, b.prefs);
    return {
      direction: eff.direction,
      layout: eff.layout,
      fit: eff.fit,
      coverOffset: eff.coverOffset,
      pairShift: eff.pairShift,
      filters: eff.filters,
      autoTrim: eff.autoTrim,
      guided: eff.guided,
      overrides: b.overrides,
      ui: uiSettings.value,
    };
  };

  // ---- open ---------------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let reader: Reader | null = null;
    document.documentElement.classList.add('reading');
    const releaseScreen = keepScreenOn(); // phones/tablets would dim and lock mid-page
    void (async () => {
      const b = await getBook(id);
      if (!b) {
        setPhase({ kind: 'error', message: S.bookGone });
        return;
      }
      const s = (await getSeries(b.seriesId)) ?? null;
      const saved = await getSetting<PrefScope>('prefScope', 'book');
      if (cancelled) return;
      state.current.book = b;
      state.current.series = s;
      setBook(b);
      setSeries(s);
      setScope(saved);
      scopeRef.current = saved;
      let source;
      try {
        source = await resolveBookSource(b);
      } catch (e) {
        const se = e instanceof SourceError ? e : null;
        setPhase({
          kind: 'error',
          message: se?.message ?? S.cannotOpen,
          source: se?.kind,
        });
        return;
      }
      const decoder = new DecodeClient(b);
      try {
        await decoder.open(source);
      } catch {
        decoder.close();
        setPhase({ kind: 'error', message: S.archiveUnopenable });
        return;
      }
      if (cancelled || !hostRef.current) {
        decoder.close();
        return;
      }
      const progress: Progress | undefined = await getProgress(b.id);
      const startPage = progress && !progress.finished ? progress.page : 0;
      reader = new Reader(hostRef.current, b, decoder, config(b, s), {
        onPage: (p, offset) => {
          state.current.page = p;
          setPage(p);
          pending.current = { page: p, offset };
          if (saveTimer.current !== null) clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => void flushProgress(), SAVE_DEBOUNCE_MS);
          const now = Date.now();
          if (now - lastAnnounce.current > 1000) {
            lastAnnounce.current = now;
            setAnnounce(`Page ${p + 1} of ${b.pageCount}`);
          }
        },
        onMenuToggle: () => setOverlay((v) => !v),
        onCommand: (cmd) => handleCommand(cmd),
        onPageMenu: (p) => setPageMenu({ page: p }),
        onEdge: (edge) => {
          if (edge === 'end' && !finishedShown.current) {
            finishedShown.current = true;
            void (async () => {
              await flushProgress();
              const siblings = await booksOfSeries(b.seriesId);
              const idx = siblings.findIndex((x) => x.id === b.id);
              setNextBook(siblings[idx + 1] ?? null);
              setFinishedPrompt(true);
            })();
          }
        },
        onState: () => setZoomed((readerRef.current?.zoom() ?? 1) > 1.02),
      });
      readerRef.current = reader;
      const resumeOffset = progress?.webtoonOffset;
      await reader.start(Math.min(startPage, b.pageCount - 1), resumeOffset);
      setPhase({ kind: 'ready' });
      setPage(reader.currentPage());
      await refreshBookmark(reader.currentPage());
    })();

    const onHide = () => void flushProgress();
    window.addEventListener('pagehide', onHide);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      if (document.querySelector('[role=dialog]')) return;
      if (e.key === 'm' || (e.key === 'Enter' && t?.tagName !== 'BUTTON')) {
        setOverlay((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      releaseScreen();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('reading');
      void flushProgress();
      reader?.destroy();
      readerRef.current = null;
    };
  }, [id]);

  // debug overlay (stats) refresh
  useEffect(() => {
    if (!isDebug()) return;
    const t = window.setInterval(() => {
      const r = readerRef.current;
      if (!r) return;
      const d = r.debug();
      setDebugText(
        `page ${d.page} canvases ${d.canvases} cache ${(d.cache.total / 1048576).toFixed(1)}/${(d.cache.budget / 1048576).toFixed(0)}MB peak ${(d.cache.peakTotal / 1048576).toFixed(1)}MB evictions ${d.cache.evictions}`,
      );
    }, 400);
    return () => clearInterval(t);
  }, []);

  const refreshBookmark = async (p: number) => {
    const b = state.current.book;
    if (!b) return;
    const list = await listBookmarks(b.id);
    setBookmarked(list.find((x) => x.page === p)?.id ?? null);
  };
  useEffect(() => {
    void refreshBookmark(page);
  }, [page]);

  // ---- preferences --------------------------------------------------------------------------
  // Preference writes are applied to the in-memory book/series synchronously (so the next call, even in
  // the same tick, starts from the result of this one) and persisted through a single queue.
  const persistQueue = useRef<Promise<unknown>>(Promise.resolve());
  const applyPref = async (patch: ReaderPrefs, forceScope?: PrefScope) => {
    const b = state.current.book;
    const s = state.current.series;
    if (!b) return;
    const sc = forceScope ?? scopeRef.current;
    const next = applyPrefPatch(sc, patch, { series: s?.prefs ?? {}, book: b.prefs });
    const nb: Book = { ...b, prefs: next.book, prefsUpdatedAt: Date.now() };
    const ns = s && sc === 'series' ? { ...s, prefs: next.series } : s;
    state.current.book = nb;
    state.current.series = ns;
    setBook(nb);
    setSeries(ns);
    readerRef.current?.setConfig(config(nb, ns));
    persistQueue.current = persistQueue.current.then(async () => {
      await patchBook(nb.id, { prefs: nb.prefs, prefsUpdatedAt: nb.prefsUpdatedAt });
      if (ns && sc === 'series') await putSeries(ns);
      bumpLibrary();
    });
    await persistQueue.current;
  };

  const setOverrides = async (overrides: PageOverride[]) => {
    await persistQueue.current; // do not let this write's result replace not-yet-saved prefs
    const b = state.current.book;
    if (!b) return;
    const nb = (await patchBook(b.id, { overrides, prefsUpdatedAt: Date.now() })) ?? b;
    state.current.book = nb;
    setBook(nb);
    readerRef.current?.setConfig(config(nb, state.current.series));
  };

  const setPageOverride = async (p: number, kind: PageOverride['kind'] | null) => {
    const b = state.current.book;
    if (!b) return;
    const rest = b.overrides.filter((o) => o.index !== p);
    await setOverrides(
      kind ? [...rest, { index: p, kind }].sort((a, c) => a.index - c.index) : rest,
    );
    setPageMenu(null);
  };

  const effective = useMemo(
    () => (book ? effectivePrefs(globalPrefs.value, series?.prefs, book.prefs) : null),
    [book, series],
  );

  const handleCommand = (cmd: NonNullable<KeyCommand>) => {
    const b = state.current.book;
    if (!b) return;
    const eff = effectivePrefs(globalPrefs.value, state.current.series?.prefs, b.prefs);
    switch (cmd) {
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        break;
      case 'cycleLayout': {
        const order = ['single', 'double', 'auto', 'webtoon'] as const;
        const nextLayout =
          order[(order.indexOf(eff.layout as (typeof order)[number]) + 1) % order.length]!;
        void applyPref({ layout: nextLayout });
        pushToast(S.layoutToast(layoutName(nextLayout)), 'info', 1500);
        break;
      }
      case 'toggleRtl':
        void applyPref({ direction: eff.direction === 'rtl' ? 'ltr' : 'rtl' });
        break;
      case 'toggleGuided':
        void applyPref({ guided: !eff.guided });
        pushToast(S.guidedToast(!eff.guided), 'info', 1500);
        break;
      case 'toggleOffset':
        void applyPref({ coverOffset: !eff.coverOffset });
        break;
      case 'shiftDown':
      case 'shiftUp':
        void applyPref({ pairShift: eff.pairShift === 1 ? 0 : 1 });
        break;
      case 'thumbs':
        setOverlay(true);
        setThumbs((v) => !v);
        break;
      case 'bookmark':
        void toggleBookmark();
        break;
      case 'escape':
        if (overlayRef.current) setOverlay(false);
        else exit();
        break;
      default:
        break;
    }
  };

  // handleCommand is captured once by the Reader; route through refs to see fresh UI state
  const overlayRef = useRef(false);
  overlayRef.current = overlay;

  const toggleBookmark = async () => {
    const b = state.current.book;
    if (!b) return;
    const p = readerRef.current?.currentPage() ?? state.current.page;
    const list = await listBookmarks(b.id);
    const existing = list.find((x) => x.page === p);
    if (existing) {
      await removeBookmark(existing.id);
      setBookmarked(null);
      pushToast(S.bookmarkRemoved, 'info', 1500);
    } else {
      const bm = await addBookmark(b, p);
      setBookmarked(bm.id);
      pushToast(S.bookmarkedPage(p + 1), 'success', 1500);
    }
  };

  const exit = () => {
    const b = state.current.book;
    void flushProgress().then(() => {
      bumpLibrary();
      leave(b ? `#/series/${encodeURIComponent(b.seriesId)}` : '#/library');
    });
  };

  const reconnect = async () => {
    const b = state.current.book;
    if (!b || b.location.kind !== 'handle') return;
    const src = await (await getDb()).get('sources', b.location.sourceId);
    if (src?.handle && (await handlePermission(src.handle, true)) === 'granted') {
      location.reload();
    } else pushToast(S.permissionNotGranted, 'error');
  };

  if (phase.kind === 'error') {
    return (
      <div class="reader-root reader-error" data-book-id={id}>
        <div class="reader-error-box">
          <h1>{S.cannotOpenTitle}</h1>
          <p>{phase.message}</p>
          <div class="stack-v">
            {phase.source === 'permission' && (
              <button class="btn primary" onClick={() => void reconnect()}>
                {S.reconnectLibrary}
              </button>
            )}
            <button class="btn" onClick={() => leave('#/library')}>
              {S.backToLibrary}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const total = book?.pageCount ?? 0;
  return (
    <div
      class="reader-root"
      data-book-id={id}
      data-overlay={overlay ? 'shown' : 'hidden'}
      data-direction={effective?.direction}
    >
      <div class="reader-surface" ref={hostRef} />
      {phase.kind === 'loading' && <div class="reader-loading">{S.opening}</div>}
      <div class="sr-only" aria-live="polite" role="status">
        {announce}
      </div>
      {isDebug() && (
        <div class="debug-overlay" data-testid="debug">
          {debugText}
        </div>
      )}
      {overlay && book && effective && (
        <Overlay
          book={book}
          page={page}
          total={total}
          direction={effective.direction}
          bookmarked={bookmarked !== null}
          thumbs={thumbs}
          zoomed={zoomed}
          decoder={readerRef.current?.decoder ?? null}
          onBack={exit}
          onBookmark={() => void toggleBookmark()}
          onSettings={() => setQuick(true)}
          onGoto={(p) => readerRef.current?.goto(p)}
          onToggleThumbs={() => setThumbs((v) => !v)}
          onLayout={() => handleCommand('cycleLayout')}
          onDirection={() => handleCommand('toggleRtl')}
          onZoomReset={() => readerRef.current?.zoomReset()}
        />
      )}
      {quick && book && effective && (
        <QuickSettings
          prefs={effective}
          scope={scope}
          overrides={book.overrides}
          hasSeries={!!series}
          onScope={(s) => {
            setScope(s);
            scopeRef.current = s;
            void setSetting('prefScope', s);
          }}
          onChange={(p) => void applyPref(p)}
          onClearOverrides={() => void setOverrides([])}
          onClose={() => setQuick(false)}
        />
      )}
      {pageMenu && book && (
        <Sheet title={S.pageMenuTitle(pageMenu.page + 1)} onClose={() => setPageMenu(null)}>
          <div class="stack-v">
            <button class="btn" onClick={() => void setPageOverride(pageMenu.page, 'single')}>
              {S.showAlone}
            </button>
            <button class="btn" onClick={() => void setPageOverride(pageMenu.page, 'spreadStart')}>
              {S.startSpread}
            </button>
            <button class="btn" onClick={() => void setPageOverride(pageMenu.page, 'hidden')}>
              {S.hidePage}
            </button>
            <button class="btn" onClick={() => void setPageOverride(pageMenu.page, null)}>
              {S.clearOverride}
            </button>
            <p class="muted">{S.savedForBook(book.overrides.length)}</p>
          </div>
        </Sheet>
      )}
      {finishedPrompt && book && (
        <Sheet title={S.reachedEnd} onClose={() => setFinishedPrompt(false)}>
          <div class="stack-v">
            {nextBook && (
              <button
                class="btn primary"
                onClick={() => {
                  setFinishedPrompt(false);
                  replaceRoute(`#/read/${encodeURIComponent(nextBook.id)}`);
                }}
              >
                {S.nextVolume(nextBook.title)}
              </button>
            )}
            <button class="btn" onClick={exit}>
              {S.backToLibrary}
            </button>
            <button class="btn" onClick={() => setFinishedPrompt(false)}>
              {S.stayHere}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
