import { signal } from '@preact/signals';
import { DEFAULT_PREFS, DEFAULT_UI, type GlobalPrefs, type UiSettings } from '../core/types.ts';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}
let toastSeq = 0;
export const toasts = signal<Toast[]>([]);
export function pushToast(text: string, kind: Toast['kind'] = 'info', ms = 5000): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, kind, text }];
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export interface ImportJob {
  id: string;
  name: string;
  bytes: number;
  total: number;
  status: 'queued' | 'copying' | 'analyzing' | 'done' | 'failed' | 'cancelled';
  message?: string;
}
export const importJobs = signal<ImportJob[]>([]);
export function updateJob(id: string, patch: Partial<ImportJob>): void {
  importJobs.value = importJobs.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
}
export function clearFinishedJobs(): void {
  importJobs.value = importJobs.value.filter(
    (j) => !['done', 'failed', 'cancelled'].includes(j.status),
  );
}

/** Bumped whenever library data changes so views reload. */
export const libraryVersion = signal(0);
export function bumpLibrary(): void {
  libraryVersion.value++;
}

export const uiSettings = signal<UiSettings>({ ...DEFAULT_UI });
export const globalPrefs = signal<GlobalPrefs>({ ...DEFAULT_PREFS });
