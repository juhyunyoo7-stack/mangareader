import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Book, Direction } from '../../core/types.ts';
import type { DecodeClient } from '../../engine/DecodeClient.ts';
import { Icon } from '../components/Icon.tsx';
import { ThumbLoader, THUMB_H, THUMB_W } from './thumbs.ts';
import { S } from '../../strings.ts';

function ThumbCanvas({
  loader,
  page,
  w = THUMB_W,
  h = THUMB_H,
}: {
  loader: ThumbLoader;
  page: number;
  w?: number;
  h?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void loader.draw(page, ref.current);
  }, [loader, page]);
  return (
    <canvas
      ref={ref}
      class="thumb-canvas"
      style={{ width: `${w}px`, height: `${h}px` }}
      aria-hidden="true"
    />
  );
}

const CELL = THUMB_W + 8;

function ThumbStrip({
  loader,
  total,
  current,
  rtl,
  onGoto,
}: {
  loader: ThumbLoader;
  total: number;
  current: number;
  rtl: boolean;
  onGoto: (p: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ from: 0, to: 12 });
  const pos = (page: number) => (rtl ? total - 1 - page : page);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollLeft / CELL) - 2);
    const last = Math.min(total - 1, Math.ceil((el.scrollLeft + el.clientWidth) / CELL) + 2);
    setRange({ from: first, to: last });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = pos(current) * CELL - el.clientWidth / 2 + CELL / 2;
    update();
    // only on open
  }, []);
  const items = [];
  for (let slot = range.from; slot <= range.to; slot++) {
    const page = rtl ? total - 1 - slot : slot;
    items.push(
      <button
        key={page}
        class="thumb"
        data-active={page === current ? '1' : undefined}
        style={{ left: `${slot * CELL}px` }}
        aria-label={S.goToPage(page + 1)}
        aria-current={page === current ? 'true' : undefined}
        onClick={() => onGoto(page)}
      >
        <ThumbCanvas loader={loader} page={page} />
        <span>{page + 1}</span>
      </button>,
    );
  }
  return (
    <div class="thumb-strip" ref={ref} onScroll={update} data-testid="thumb-strip">
      <div class="thumb-spacer" style={{ width: `${total * CELL}px` }}>
        {items}
      </div>
    </div>
  );
}

export function Overlay(props: {
  book: Book;
  page: number;
  total: number;
  direction: Direction;
  bookmarked: boolean;
  thumbs: boolean;
  zoomed: boolean;
  decoder: DecodeClient | null;
  onBack: () => void;
  onBookmark: () => void;
  onSettings: () => void;
  onGoto: (p: number) => void;
  onToggleThumbs: () => void;
  onLayout: () => void;
  onDirection: () => void;
  onZoomReset: () => void;
}) {
  const { book, page, total, direction } = props;
  const rtl = direction === 'rtl';
  const [drag, setDrag] = useState<number | null>(null);
  const loader = useMemo(
    () => (props.decoder ? new ThumbLoader(props.decoder, book.id) : null),
    [props.decoder, book.id],
  );
  useEffect(() => () => loader?.dispose(), [loader]);
  const shown = (drag ?? page) + 1;
  return (
    <>
      <header class="overlay-top">
        <button class="btn-icon" aria-label={S.backToLibrary} onClick={props.onBack}>
          <Icon name="back" />
        </button>
        <div class="overlay-title" title={book.title}>
          {book.title}
        </div>
        <button
          class="btn-icon"
          aria-label={props.bookmarked ? S.removeBookmark : S.addBookmark}
          aria-pressed={props.bookmarked}
          data-on={props.bookmarked ? '1' : undefined}
          onClick={props.onBookmark}
        >
          <Icon name="bookmark" />
        </button>
        <button class="btn-icon" aria-label={S.readerSettings} onClick={props.onSettings}>
          <Icon name="sliders" />
        </button>
      </header>
      <footer class="overlay-bottom">
        {props.thumbs && loader && (
          <ThumbStrip
            loader={loader}
            total={total}
            current={page}
            rtl={rtl}
            onGoto={props.onGoto}
          />
        )}
        {drag !== null && loader && (
          <div class="slider-preview" style={{ left: `${((drag + 0.5) / total) * 100}%` }}>
            <ThumbCanvas loader={loader} page={drag} />
          </div>
        )}
        <div class="slider-row">
          <span class="page-label" data-testid="page-label">
            {shown} / {total}
          </span>
          <input
            type="range"
            class="page-slider"
            aria-label={S.pageWord}
            min={1}
            max={total}
            step={1}
            value={shown}
            dir={rtl ? 'rtl' : 'ltr'}
            onInput={(e) => setDrag(Number(e.currentTarget.value) - 1)}
            onChange={(e) => {
              setDrag(null);
              props.onGoto(Number(e.currentTarget.value) - 1);
            }}
          />
        </div>
        <div class="quick-row">
          <button class="btn small" onClick={props.onToggleThumbs} aria-pressed={props.thumbs}>
            <Icon name="list" size={16} /> {S.pagesBtn}
          </button>
          <button class="btn small" onClick={props.onLayout}>
            {S.layoutBtn}
          </button>
          <button class="btn small" onClick={props.onDirection}>
            {rtl ? S.dirRtl : S.dirLtr}
          </button>
          {props.zoomed && (
            <button class="btn small" onClick={props.onZoomReset}>
              {S.resetZoom}
            </button>
          )}
        </div>
      </footer>
    </>
  );
}
