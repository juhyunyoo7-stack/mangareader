import { useEffect, useState } from 'preact/hooks';
import type { Book, Series } from '../../core/types.ts';
import { booksOfSeries, getSeries } from '../../data/repo.ts';
import { Icon } from '../components/Icon.tsx';
import { navigate } from '../router.ts';
import { libraryVersion } from '../store.ts';
import { BookCard } from './BookCard.tsx';
import { BookMenu } from './BookMenu.tsx';
import { useLibraryData } from './data.ts';
import { S } from '../../strings.ts';

export function SeriesView({ id }: { id: string }) {
  const [series, setSeries] = useState<Series | null | undefined>(undefined);
  const [books, setBooks] = useState<Book[]>([]);
  const [menu, setMenu] = useState<Book | null>(null);
  const { progress } = useLibraryData();
  const v = libraryVersion.value;
  useEffect(() => {
    void (async () => {
      setSeries((await getSeries(id)) ?? null);
      setBooks(await booksOfSeries(id));
    })();
  }, [id, v]);

  if (series === undefined) return <div class="page" />;
  if (series === null) {
    return (
      <div class="page">
        <p>{S.seriesNotFound}</p>
        <button class="btn" onClick={() => navigate('#/library')}>
          {S.backToLibrary}
        </button>
      </div>
    );
  }
  const next =
    books.find((b) => b.status === 'reading') ??
    books.find((b) => b.status === 'unread') ??
    books[0];
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn-icon" aria-label={S.backToLibrary} onClick={() => navigate('#/library')}>
          <Icon name="back" />
        </button>
        <h1>{series.name}</h1>
        {next && next.location.kind !== 'offloaded' && (
          <button
            class="btn primary"
            onClick={() => navigate(`#/read/${encodeURIComponent(next.id)}`)}
          >
            <Icon name="play" size={16} />{' '}
            {next.status === 'reading' ? S.continueBtn : S.startReading}
          </button>
        )}
      </header>
      <div class="grid">
        {books.map((b) => (
          <BookCard
            key={b.id}
            book={b}
            progress={progress.get(b.id)}
            onOpen={() => navigate(`#/read/${encodeURIComponent(b.id)}`)}
            onMenu={() => setMenu(b)}
          />
        ))}
      </div>
      {menu && <BookMenu book={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
