import { useEffect, useState } from 'preact/hooks';
import { storageEstimate } from '../../data/opfs.ts';
import { libraryVersion } from '../store.ts';
import { formatBytes } from './data.ts';
import { S } from '../../strings.ts';

export function useStorage() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const v = libraryVersion.value;
  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [v]);
  return est;
}

export function StorageMeter({ compact = false }: { compact?: boolean }) {
  const est = useStorage();
  if (!est || est.quota === 0) return null;
  const pct = Math.min(100, (est.usage / est.quota) * 100);
  if (compact && pct < 50) return null;
  return (
    <div class="storage-meter" data-testid="storage-meter">
      <progress max={100} value={pct} aria-label={S.storageUsedLabel} />
      <span>{S.storageUsedOf(formatBytes(est.usage), formatBytes(est.quota))}</span>
    </div>
  );
}
