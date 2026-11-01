import { useEffect } from 'preact/hooks';
import { cancelActiveImport } from '../../data/importer.ts';
import { clearFinishedJobs, dismissToast, importJobs, toasts } from '../store.ts';
import { formatBytes } from '../library/data.ts';
import { S } from '../../strings.ts';

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          <button class="btn-icon" aria-label={S.dismiss} onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function ImportPanel() {
  const jobs = importJobs.value;
  const active = jobs.some((j) => ['queued', 'copying', 'analyzing'].includes(j.status));
  const allOk = jobs.length > 0 && jobs.every((j) => j.status === 'done');
  // a fully successful batch goes away by itself; failures stay until dismissed
  useEffect(() => {
    if (active || !allOk) return;
    const t = setTimeout(clearFinishedJobs, 4000);
    return () => clearTimeout(t);
  }, [active, allOk, jobs.length]);
  if (jobs.length === 0) return null;
  return (
    <section class="import-panel" aria-label={S.imports}>
      <header>
        <strong>{active ? S.importing : S.imports}</strong>
        <span class="spacer" />
        {active ? (
          <button class="btn small" onClick={cancelActiveImport}>
            {S.cancelCurrent}
          </button>
        ) : (
          <button class="btn small" onClick={clearFinishedJobs}>
            {S.clear}
          </button>
        )}
      </header>
      <ul>
        {jobs.slice(-6).map((j) => (
          <li key={j.id} data-status={j.status}>
            <div class="job-name">{j.name}</div>
            <div class="job-meta">
              {j.status === 'copying'
                ? `${formatBytes(j.bytes)} / ${formatBytes(j.total)}`
                : j.status === 'failed' || j.status === 'cancelled'
                  ? (j.message ?? S.jobStatus[j.status])
                  : S.jobStatus[j.status]}
            </div>
            {j.status === 'copying' && (
              <progress max={j.total || 1} value={j.bytes} aria-label={S.copyingLabel(j.name)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Fixed bottom stack that never covers the toolbar: import panel above toasts. */
export function Floaters() {
  return (
    <div class="floaters">
      <ImportPanel />
      <Toasts />
    </div>
  );
}
