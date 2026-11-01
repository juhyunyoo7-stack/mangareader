import type { Direction, ZonePreset } from '../core/types.ts';

export type Action = 'next' | 'prev' | 'menu' | 'none';

/**
 * Tap-zone hit testing. `next`/`prev` are in reading order, so RTL books swap left and right and
 * vertical books use top/bottom.
 */
export function zoneAction(
  preset: ZonePreset,
  direction: Direction,
  x: number,
  y: number,
  w: number,
  h: number,
): Action {
  if (w <= 0 || h <= 0) return 'none';
  const fx = x / w;
  const fy = y / h;
  const edge = preset === 'edge' ? 0.15 : 0.3;
  if (preset === 'off') return 'menu';
  if (direction === 'vertical') {
    if (fy < edge) return 'prev';
    if (fy > 1 - edge) return 'next';
    return 'menu';
  }
  if (fx < edge) return direction === 'rtl' ? 'next' : 'prev';
  if (fx > 1 - edge) return direction === 'rtl' ? 'prev' : 'next';
  return 'menu';
}

export type KeyCommand =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'fullscreen'
  | 'cycleLayout'
  | 'toggleRtl'
  | 'toggleOffset'
  | 'toggleGuided'
  | 'shiftDown'
  | 'shiftUp'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'thumbs'
  | 'bookmark'
  | 'escape'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | null;

export function keyCommand(
  e: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  direction: Direction,
  zoomed: boolean,
): KeyCommand {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const rtl = direction === 'rtl';
  switch (e.key) {
    case 'ArrowRight':
      return zoomed ? 'panRight' : rtl ? 'prev' : 'next';
    case 'ArrowLeft':
      return zoomed ? 'panLeft' : rtl ? 'next' : 'prev';
    case 'ArrowDown':
      return zoomed ? 'panDown' : 'next';
    case 'ArrowUp':
      return zoomed ? 'panUp' : 'prev';
    case 'PageDown':
      return 'next';
    case 'PageUp':
      return 'prev';
    case ' ':
      return e.shiftKey ? 'prev' : 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'f':
    case 'F':
      return 'fullscreen';
    case 'd':
    case 'D':
      return 'cycleLayout';
    case 'r':
    case 'R':
      return 'toggleRtl';
    case 'o':
    case 'O':
      return 'toggleOffset';
    case 'g':
    case 'G':
      return 'toggleGuided';
    case '[':
      return 'shiftDown';
    case ']':
      return 'shiftUp';
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    case '0':
      return 'zoomReset';
    case 't':
    case 'T':
      return 'thumbs';
    case 'b':
    case 'B':
      return 'bookmark';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

export interface SwipeResult {
  action: 'next' | 'prev' | null;
}

/** Interpret a finished single-finger drag as a page-turn swipe. */
export function classifySwipe(
  dx: number,
  dy: number,
  dt: number,
  direction: Direction,
  minDist = 50,
): SwipeResult {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (direction === 'vertical') {
    if (ay < minDist || ay < ax * 1.2 || dt > 800) return { action: null };
    return { action: dy < 0 ? 'next' : 'prev' };
  }
  if (ax < minDist || ax < ay * 1.2 || dt > 800) return { action: null };
  // finger moves left => content moves left => next page in LTR; mirrored in RTL
  const left = dx < 0;
  return { action: direction === 'rtl' ? (left ? 'prev' : 'next') : left ? 'next' : 'prev' };
}
