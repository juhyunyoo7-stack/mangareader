import { useMemo, useRef, useState } from 'preact/hooks';
import type { Book } from '../../core/types.ts';
import { importFiles } from '../../data/importer.ts';
import { navigate } from '../router.ts';
import { pushToast } from '../store.ts';
import { BookCard, SeriesCard } from './BookCard.tsx';
import { BookMenu } from './BookMenu.tsx';
import {
  buildSearchEntry,
  matchesQuery,
  sortBooks,
  sortSeries,
  useLibraryData,
  type SortKey,
} from './data.ts';
import { Icon } from '../components/Icon.tsx';
import { FolderControls, ReconnectBanner } from './FolderControls.tsx';
import { InstallHint } from '../components/InstallHint.tsx';
import { StorageMeter } from './StorageMeter.tsx';
import { S } from '../../strings.ts';

export async function runImport(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const results = await importFiles(files);
  const added = results.filter((r) => r.status === 'added').length;
  const re = results.filter((r) => r.status === 'reattached').length;
  const dup = results.filter((r) => r.status === 'duplicate');
  const failed = results.filter((r) => r.status === 'failed');
  if (added) pushToast(S.importedBooks(added), 'success');
  if (re) pushToast(S.reattached(re), 'success');
  if (dup.length) pushToast(S.alreadyInLibraryNamed(dup.map((d) => d.name).join(', ')), 'info');
  for (const f of failed)
    pushToast(`${f.name}: ${f.message ?? S.importFailedGeneric}`, 'error', 9000);
}

export function ImportButton({ primary = false }: { primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button class={primary ? 'btn primary' : 'btn'} onClick={() => input.current?.click()}>
        <Icon name="plus" size={18} /> {S.importBooks}
      </button>
      {/* No `accept`: iOS greys out files when extension filters are used. Content is verified by magic bytes. */}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const el = e.currentTarget;
          const files = [...(el.files ?? [])];
          el.value = '';
          void runImport(files);
        }}
      />
    </>
  );
}

export function LibraryView() {
  const data = useLibraryData();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<'series' | 'books'>('series');
  const [menuBook, setMenuBook] = useState<Book | null>(null);

  const seriesById = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const countBySeries = useMemo(() => {
    const m = new Map<string, Book[]>();
    for (const b of data.books) {
      const l = m.get(b.seriesId) ?? [];
      l.push(b);
      m.set(b.seriesId, l);
    }
    return m;
  }, [data.books]);

  const continueReading = useMemo(
    () =>
      data.books
        .filter((b) => {
          const p = data.progress.get(b.id);
          return p && !p.finished && p.page > 0 && b.status === 'reading';
        })
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, 12),
    [data.books, data.progress],
  );

  const index = useMemo(
    () =>
      new Map(
        data.books.map((b) => [b.id, buildSearchEntry(b, seriesById.get(b.seriesId)?.name ?? '')]),
      ),
    [data.books, seriesById],
  );
  const searching = query.trim() !== '';
  const matched = useMemo(() => {
    if (!searching) return [];
    return sortBooks(
      data.books.filter((b) => matchesQuery(index.get(b.id)!, query)),
      sort,
      data.progress,
    );
  }, [data.books, data.progress, query, sort, searching, index]);

  const open = (b: Book) => navigate(`#/read/${encodeURIComponent(b.id)}`);

  return (
    <div class="page">
      <header class="page-head">
        <h1>{S.library}</h1>
        <div class="toolbar">
          <label class="search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder={S.search}
              aria-label={S.searchLibrary}
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <label class="select">
            <span class="sr-only">{S.sort}</span>
            <select
              aria-label={S.sort}
              value={sort}
              onChange={(e) => setSort(e.currentTarget.value as SortKey)}
            >
              <option value="name">{S.sortName}</option>
              <option value="recent">{S.sortRecent}</option>
              <option value="added">{S.sortAdded}</option>
              <option value="progress">{S.sortProgress}</option>
              <option value="size">{S.sortSize}</option>
            </select>
          </label>
          <div class="seg" role="group" aria-label={S.view}>
            <button aria-pressed={view === 'series'} onClick={() => setView('series')}>
              {S.viewSeries}
            </button>
            <button aria-pressed={view === 'books'} onClick={() => setView('books')}>
              {S.viewAll}
            </button>
          </div>
          <ImportButton primary />
          <FolderControls />
        </div>
      </header>

      <ReconnectBanner />
      <InstallHint />
      <StorageMeter compact />

      {data.loading ? null : data.books.length === 0 ? (
        <div class="empty">
          <h2>{S.noBooksTitle}</h2>
          <p>{S.noBooksBody}</p>
          <ImportButton primary />
        </div>
      ) : searching ? (
        <section aria-label={S.searchResults}>
          <h2 class="section">{S.resultsCount(matched.length)}</h2>
          <div class="grid">
            {matched.map((b) => (
              <BookCard
                key={b.id}
                book={b}
                progress={data.progress.get(b.id)}
                onOpen={() => open(b)}
                onMenu={() => setMenuBook(b)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {continueReading.length > 0 && (
            <section aria-label={S.continueReading}>
              <h2 class="section">{S.continueReading}</h2>
              <div class="row">
                {continueReading.map((b) => (
                  <BookCard
                    key={b.id}
                    book={b}
                    progress={data.progress.get(b.id)}
                    onOpen={() => open(b)}
                    onMenu={() => setMenuBook(b)}
                  />
                ))}
              </div>
            </section>
          )}
          <section aria-label={view === 'series' ? S.viewSeries : S.viewAll}>
            <h2 class="section">{view === 'series' ? S.viewSeries : S.viewAll}</h2>
            <div class="grid">
              {view === 'series'
                ? sortSeries(data.series, sort, data.books).map((s) => {
                    const books = countBySeries.get(s.id) ?? [];
                    const cover = books.find((b) => b.id === s.coverBookId) ?? books[0];
                    return (
                      <SeriesCard
                        key={s.id}
                        series={s}
                        count={books.length}
                        cover={cover}
                        onOpen={() => navigate(`#/series/${encodeURIComponent(s.id)}`)}
                      />
                    );
                  })
                : sortBooks(data.books, sort, data.progress).map((b) => (
                    <BookCard
                      key={b.id}
                      book={b}
                      progress={data.progress.get(b.id)}
                      onOpen={() => open(b)}
                      onMenu={() => setMenuBook(b)}
                    />
                  ))}
            </div>
          </section>
        </>
      )}
      {menuBook && <BookMenu book={menuBook} onClose={() => setMenuBook(null)} />}
    </div>
  );
}
