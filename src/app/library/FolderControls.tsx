import { useEffect, useState } from 'preact/hooks';
import {
  addLibraryFolder,
  listSourceStatus,
  openFilesInPlace,
  reconnectSource,
  type SourceStatus,
} from '../../data/fsa.ts';
import { caps } from '../../platform/web.ts';
import { Icon } from '../components/Icon.tsx';
import { libraryVersion, pushToast } from '../store.ts';
import { S } from '../../strings.ts';

export function FolderControls() {
  const c = caps();
  return (
    <>
      {c.fsaDirectory && (
        <button class="btn" onClick={() => void addLibraryFolder()}>
          <Icon name="folder" size={18} /> {S.addFolder}
        </button>
      )}
      {c.fsaOpenFile && (
        <button class="btn" onClick={() => void openFilesInPlace()} title={S.openInPlaceHint}>
          {S.openInPlace}
        </button>
      )}
    </>
  );
}

export function useSources(): SourceStatus[] {
  const [list, setList] = useState<SourceStatus[]>([]);
  const v = libraryVersion.value;
  useEffect(() => {
    let alive = true;
    void listSourceStatus().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [v]);
  return list;
}

/** One-tap reconnect for library folders whose permission needs a user gesture after a restart. */
export function ReconnectBanner() {
  const sources = useSources().filter((s) => s.permission !== 'granted' && s.bookCount > 0);
  if (sources.length === 0) return null;
  return (
    <>
      {sources.map(({ source }) => (
        <div class="banner" role="status" key={source.id} data-testid="reconnect-banner">
          <span>{S.reconnectBanner(source.name)}</span>
          <button
            class="btn small primary"
            onClick={async () => {
              const ok = await reconnectSource(source.id);
              if (!ok) pushToast(S.permissionNotGranted, 'error');
            }}
          >
            {S.reconnectLibrary}
          </button>
        </div>
      ))}
    </>
  );
}
