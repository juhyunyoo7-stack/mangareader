import { useEffect, useRef, useState } from 'preact/hooks';
import type { Direction, LayoutMode, Theme } from '../../core/types.ts';
import { downloadState, importStateFile } from '../../data/backup.ts';
import { reconnectSource, removeSource, reportScan, scanSource } from '../../data/fsa.ts';
import { listBooks, setSetting } from '../../data/repo.ts';
import { eraseEverything, offloadFinished } from '../../data/storage.ts';
import { LOCALE_NAMES, locale, S, setLocale, type LocaleCode } from '../../strings.ts';
import { applyTheme } from '../theme.ts';
import { Sheet } from '../components/Sheet.tsx';
import { useSources } from '../library/FolderControls.tsx';
import { StorageMeter } from '../library/StorageMeter.tsx';
import { bumpLibrary, globalPrefs, pushToast, uiSettings } from '../store.ts';

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div class="setting">
      <span class="label">{label}</span>
      <div class="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsView() {
  const sources = useSources();
  const [erase, setErase] = useState<0 | 1 | 2>(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.title = `${S.settings} - MangaReader`;
  }, []);

  const ui = uiSettings.value;
  const prefs = globalPrefs.value;
  const setTheme = (theme: Theme) => {
    uiSettings.value = { ...ui, theme };
    applyTheme();
    void setSetting('ui', uiSettings.value);
  };
  const setPref = (patch: { direction?: Direction; layout?: LayoutMode }) => {
    globalPrefs.value = { ...prefs, ...patch };
    void setSetting('global.prefs', globalPrefs.value);
  };

  return (
    <div class="page" data-testid="settings">
      <header class="page-head">
        <h1>{S.settings}</h1>
      </header>

      <section class="settings-group" aria-label={S.appearance}>
        <h2>{S.appearance}</h2>
        <Seg<Theme>
          label={S.theme}
          value={ui.theme}
          options={[
            ['dark', S.themeDark],
            ['light', S.themeLight],
            ['oled', S.themeOled],
          ]}
          onChange={setTheme}
        />
        <Seg<LocaleCode>
          label={S.language}
          value={locale}
          options={(Object.keys(LOCALE_NAMES) as LocaleCode[]).map((c) => [c, LOCALE_NAMES[c]])}
          onChange={setLocale}
        />
      </section>

      <section class="settings-group" aria-label={S.readingDefaults}>
        <h2>{S.readingDefaults}</h2>
        <Seg<Direction>
          label={S.direction}
          value={prefs.direction}
          options={[
            ['ltr', S.dirLtr],
            ['rtl', S.dirRtl],
            ['vertical', S.dirVertical],
          ]}
          onChange={(direction) => setPref({ direction })}
        />
        <Seg<LayoutMode>
          label={S.layout}
          value={prefs.layout}
          options={[
            ['auto', S.layoutAuto],
            ['single', S.layoutSingle],
            ['double', S.layoutDouble],
            ['webtoon', S.layoutWebtoon],
          ]}
          onChange={(layout) => setPref({ layout })}
        />
      </section>

      <section class="settings-group" aria-label={S.sources}>
        <h2>{S.sources}</h2>
        {sources.length === 0 && (
          <div class="setting">
            <span class="label hint">{S.noSources}</span>
          </div>
        )}
        {sources.map(({ source, permission, bookCount }) => (
          <div class="setting" key={source.id} data-testid="source-row">
            <span class="label">
              {source.name}
              <span class="hint">
                {S.booksCount(bookCount)}
                {permission !== 'granted' ? ` - ${S.permissionNeeded}` : ''}
              </span>
            </span>
            {permission !== 'granted' ? (
              <button
                class="btn small primary"
                onClick={async () => {
                  if (!(await reconnectSource(source.id)))
                    pushToast(S.permissionNotGranted, 'error');
                }}
              >
                {S.reconnect}
              </button>
            ) : (
              source.kind === 'fsaDir' && (
                <button
                  class="btn small"
                  onClick={async () => {
                    reportScan(source.name, await scanSource(source.id));
                    bumpLibrary();
                  }}
                >
                  {S.rescan}
                </button>
              )
            )}
            <button class="btn small danger" onClick={() => void removeSource(source.id)}>
              {S.remove}
            </button>
          </div>
        ))}
      </section>

      <section class="settings-group" aria-label={S.storage}>
        <h2>{S.storage}</h2>
        <div class="setting">
          <StorageMeter />
        </div>
        <div class="setting">
          <span class="label">
            {S.offloadFinished}
            <span class="hint">{S.offloadFinishedHint}</span>
          </span>
          <button
            class="btn"
            data-testid="offload-finished"
            onClick={async () =>
              pushToast(S.offloaded(await offloadFinished(await listBooks())), 'success')
            }
          >
            {S.offloadFinished}
          </button>
        </div>
      </section>

      <section class="settings-group" aria-label={S.backup}>
        <h2>{S.backup}</h2>
        <div class="setting">
          <span class="label">
            {S.exportState}
            <span class="hint">{S.exportHint}</span>
          </span>
          <button class="btn" data-testid="export-state" onClick={() => void downloadState()}>
            {S.exportState}
          </button>
        </div>
        <div class="setting">
          <span class="label">
            {S.importState}
            <span class="hint">{S.importHint}</span>
          </span>
          <button class="btn" onClick={() => fileRef.current?.click()}>
            {S.importState}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="state-input"
            onChange={async (e) => {
              const input = e.currentTarget;
              const f = input.files?.[0];
              input.value = '';
              if (!f) return;
              try {
                const r = await importStateFile(f);
                bumpLibrary();
                pushToast(S.importDone(r.booksMatched, r.booksPending), 'success');
              } catch {
                pushToast(S.importFailed, 'error');
              }
            }}
          />
        </div>
      </section>

      <section class="settings-group" aria-label={S.danger}>
        <h2>{S.danger}</h2>
        <div class="setting">
          <span class="label">
            {S.eraseAll}
            <span class="hint">{S.eraseHint}</span>
          </span>
          <button class="btn danger" data-testid="erase-all" onClick={() => setErase(1)}>
            {S.eraseAll}
          </button>
        </div>
      </section>

      {erase > 0 && (
        <Sheet title={erase === 1 ? S.eraseTitle : S.eraseAgainTitle} onClose={() => setErase(0)}>
          <p>{erase === 1 ? S.eraseBody : S.eraseAgainBody}</p>
          <div class="toolbar">
            <button class="btn" onClick={() => setErase(0)}>
              {S.cancel}
            </button>
            {erase === 1 ? (
              <button class="btn danger" data-testid="erase-continue" onClick={() => setErase(2)}>
                {S.continue}
              </button>
            ) : (
              <button
                class="btn danger"
                data-testid="erase-confirm"
                onClick={async () => {
                  setErase(0);
                  await eraseEverything();
                  pushToast(S.erased, 'success');
                }}
              >
                {S.eraseConfirm}
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
