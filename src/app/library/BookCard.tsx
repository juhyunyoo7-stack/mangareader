import { useEffect, useState } from 'preact/hooks';
import type { Book, Progress, Series } from '../../core/types.ts';
import { coverUrl } from './data.ts';
import { S } from '../../strings.ts';

export function Cover({
  bookId,
  alt,
  hasCover,
}: {
  bookId: string;
  alt: string;
  hasCover: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (hasCover) void coverUrl(bookId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [bookId, hasCover]);
  return url ? (
    <img class="cover" src={url} alt={alt} loading="lazy" draggable={false} />
  ) : (
    <div class="cover cover-placeholder" role="img" aria-label={alt}>
      <span>{alt.slice(0, 2)}</span>
    </div>
  );
}

export function BookCard({
  book,
  progress,
  onOpen,
  onMenu,
}: {
  book: Book;
  progress?: Progress;
  onOpen: () => void;
  onMenu?: () => void;
}) {
  const pct = progress ? progress.percent : 0;
  const offloaded = book.location.kind === 'offloaded';
  return (
    <div class="card" data-testid="book-card" data-book-id={book.id}>
      <button class="card-main" onClick={onOpen} aria-label={S.openBook(book.title)}>
        <div class="cover-wrap">
          <Cover bookId={book.id} alt={book.title} hasCover={book.hasCover} />
          {offloaded && <span class="badge">{S.badgeOffloaded}</span>}
          {book.missing && <span class="badge badge-warn">{S.badgeMissing}</span>}
          {book.status === 'read' && <span class="badge badge-ok">{S.badgeRead}</span>}
          {pct > 0 && book.status !== 'read' && (
            <div class="bar" aria-hidden="true">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div class="card-title">{book.title}</div>
        <div class="card-sub">
          {S.pagesCount(book.pageCount)}
          {progress && book.status !== 'read' ? ` · ${pct}%` : ''}
        </div>
      </button>
      {onMenu && (
        <button class="card-more" aria-label={S.actionsFor(book.title)} onClick={onMenu}>
          ⋯
        </button>
      )}
    </div>
  );
}

export function SeriesCard({
  series,
  count,
  cover,
  onOpen,
}: {
  series: Series;
  count: number;
  cover?: Book;
  onOpen: () => void;
}) {
  return (
    <div class="card" data-testid="series-card" data-series={series.name}>
      <button class="card-main" onClick={onOpen} aria-label={S.openSeries(series.name)}>
        <div class="cover-wrap stack">
          <Cover
            bookId={cover?.id ?? series.id}
            alt={series.name}
            hasCover={cover?.hasCover ?? false}
          />
          <span class="badge badge-count">{count}</span>
        </div>
        <div class="card-title">{series.name}</div>
        <div class="card-sub">{S.volumesCount(count)}</div>
      </button>
    </div>
  );
}
