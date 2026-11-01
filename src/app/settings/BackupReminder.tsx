import { useEffect, useState } from 'preact/hooks';
import { downloadState, isBackupDue, snoozeBackupReminder } from '../../data/backup.ts';
import { S } from '../../strings.ts';
import { libraryVersion } from '../store.ts';

/** Shown at the top of the library when no backup happened for 14 days. */
export function BackupReminder() {
  const [due, setDue] = useState(false);
  const v = libraryVersion.value;
  useEffect(() => {
    void isBackupDue().then(setDue);
  }, [v]);
  if (!due) return null;
  return (
    <div class="banner" role="status" data-testid="backup-reminder">
      <span>{S.backupDue}</span>
      <button
        class="btn small primary"
        onClick={async () => {
          await downloadState();
          setDue(false);
        }}
      >
        {S.backupNow}
      </button>
      <button
        class="btn small"
        onClick={async () => {
          await snoozeBackupReminder();
          setDue(false);
        }}
      >
        {S.later}
      </button>
    </div>
  );
}
