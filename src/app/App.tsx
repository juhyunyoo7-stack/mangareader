import { useEffect } from 'preact/hooks';
import { cleanupIncoming } from '../data/importer.ts';
import { getGlobalPrefs, getUiSettings } from '../data/repo.ts';
import { requestPersistence } from '../data/opfs.ts';
import { applyTheme } from './theme.ts';
import { BackupReminder } from './settings/BackupReminder.tsx';
import { Icon } from './components/Icon.tsx';
import { Floaters, Toasts } from './components/Toasts.tsx';
import { LibraryView, runImport } from './library/LibraryView.tsx';
import { SeriesView } from './library/SeriesView.tsx';
import { ReaderHost } from './reader/ReaderHost.tsx';
import { navigate, route } from './router.ts';
import { SettingsView } from './settings/SettingsView.tsx';
import { globalPrefs, pushToast, uiSettings } from './store.ts';
import { importSharedFiles } from '../data/shared.ts';
import { setupDropAndLaunch } from '../data/dropImport.ts';
import { S } from '../strings.ts';

export function App() {
  useEffect(() => {
    void (async () => {
      uiSettings.value = await getUiSettings();
      globalPrefs.value = await getGlobalPrefs();
      applyTheme();
      await cleanupIncoming();
      void requestPersistence();
      const n = await importSharedFiles();
      if (n > 0) pushToast(S.importedShared(n), 'success');
    })();
    return setupDropAndLaunch(runImport);
  }, []);

  const r = route.value;
  if (r.name === 'read') {
    return (
      <>
        <ReaderHost key={r.id} id={r.id} />
        <Toasts />
      </>
    );
  }
  return (
    <div class="shell">
      <nav class="nav" aria-label={S.navMain}>
        <div class="brand">{S.appName}</div>
        <a
          href="#/library"
          class={r.name === 'library' || r.name === 'series' ? 'active' : ''}
          aria-current={r.name === 'library' || r.name === 'series' ? 'page' : undefined}
        >
          <Icon name="library" /> <span>{S.navLibrary}</span>
        </a>
        <a
          href="#/settings"
          class={r.name === 'settings' ? 'active' : ''}
          aria-current={r.name === 'settings' ? 'page' : undefined}
        >
          <Icon name="settings" /> <span>{S.settings}</span>
        </a>
      </nav>
      <main class="content" id="main">
        {r.name === 'library' && <BackupReminder />}
        {r.name === 'series' ? (
          <SeriesView id={r.id} />
        ) : r.name === 'settings' ? (
          <SettingsView />
        ) : (
          <LibraryView />
        )}
      </main>
      <Floaters />
    </div>
  );
}

export { navigate };
