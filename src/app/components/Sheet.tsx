import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { S } from '../../strings.ts';

/** Modal bottom sheet / dialog. Escape and backdrop click close it. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // layout effect: the Escape listener must exist as soon as the sheet is on screen (a passive effect
  // runs after paint, and a key pressed in that gap was lost)
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div
      class="sheet-backdrop"
      onClick={() => {
        // a long-press that opened this sheet ends with a click on the backdrop: ignore it
        if (performance.now() - openedAt.current > 400) closeRef.current();
      }}
    >
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button class="btn-icon" aria-label={S.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
