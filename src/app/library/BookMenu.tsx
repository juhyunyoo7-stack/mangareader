import { useState } from 'preact/hooks';
import type { Book } from '../../core/types.ts';
import { copyBookIntoStorage } from '../../data/fsa.ts';
import { offloadBook, removeBook } from '../../data/storage.ts';
import { Sheet } from '../components/Sheet.tsx';
import { navigate } from '../router.ts';
import { pushToast } from '../store.ts';
import { formatBytes } from './data.ts';
import { S } from '../../strings.ts';

export function BookMenu({ book, onClose }: { book: Book; onClose: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const offloaded = book.location.kind === 'offloaded';
  return (
    <Sheet title={book.title} onClose={onClose}>
      <p class="muted">{S.bookMeta(book.pageCount, formatBytes(book.size), book.fileName)}</p>
      <div class="stack-v">
        {!offloaded && (
          <button
            class="btn"
            onClick={() => {
              onClose();
              navigate(`#/read/${encodeURIComponent(book.id)}`);
            }}
          >
            {S.open}
          </button>
        )}
        {book.location.kind === 'opfs' && (
          <button
            class="btn"
            onClick={async () => {
              await offloadBook(book);
              pushToast(S.offloadToast, 'info', 8000);
              onClose();
            }}
          >
            {S.offloadBtn}
          </button>
        )}
        {book.location.kind === 'handle' && (
          <button
            class="btn"
            onClick={async () => {
              try {
                await copyBookIntoStorage(book);
                pushToast(S.copiedToast, 'success');
              } catch {
                pushToast(S.copyFailedToast, 'error');
              }
              onClose();
            }}
          >
            {S.copyToStorage}
          </button>
        )}
        {offloaded && <p class="muted">{S.offloadedNote}</p>}
        {!confirmRemove ? (
          <button class="btn danger" onClick={() => setConfirmRemove(true)}>
            {S.removeFromLibrary}
          </button>
        ) : (
          <button
            class="btn danger"
            onClick={async () => {
              await removeBook(book);
              pushToast(S.removedToast(book.title), 'info');
              onClose();
            }}
          >
            {S.confirmRemove}
          </button>
        )}
      </div>
    </Sheet>
  );
}
