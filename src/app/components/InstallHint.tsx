import { useState } from 'preact/hooks';
import { caps } from '../../platform/web.ts';
import { applyUpdate, isStandalone, updateReady } from '../pwa.ts';
import { S } from '../../strings.ts';

const KEY = 'mr.installHintDismissed';

export function InstallHint() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(KEY) === '1');
  return (
    <>
      {updateReady.value && (
        <div class="banner" role="status">
          <span>{S.updateReady}</span>
          <button class="btn small primary" onClick={applyUpdate}>
            {S.reloadToUpdate}
          </button>
        </div>
      )}
      {!dismissed && !isStandalone() && caps().isIOS && (
        <div class="banner" role="note">
          <span>{S.installHint}</span>
          <button
            class="btn small"
            onClick={() => {
              localStorage.setItem(KEY, '1');
              setDismissed(true);
            }}
          >
            {S.dismiss}
          </button>
        </div>
      )}
    </>
  );
}
