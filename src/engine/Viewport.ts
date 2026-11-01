import type { Direction, FitMode } from '../core/types.ts';

/** Pure zoom/pan/fit math (DESIGN 7.5). Coordinates are CSS pixels in the viewport. */
export interface Size {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface View {
  zoom: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const DOUBLE_TAP_ZOOM = 2.5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** CSS scale applied to the natural content size so that it fits the viewport per fit mode. */
export function fitScale(mode: FitMode, content: Size, view: Size, dpr: number): number {
  if (content.w <= 0 || content.h <= 0) return 1;
  switch (mode) {
    case 'width':
      return view.w / content.w;
    case 'height':
      return view.h / content.h;
    case 'original':
      return 1 / dpr;
    case 'screen':
    default:
      return Math.min(view.w / content.w, view.h / content.h);
  }
}

function clampAxis(t: number, viewDim: number, contentDim: number, overscroll: number): number {
  if (contentDim <= viewDim) return (viewDim - contentDim) / 2;
  const min = viewDim - contentDim;
  return Math.min(overscroll, Math.max(min - overscroll, t));
}

/** Keep the zoomed content covering the viewport (or centred when smaller). */
export function clampPan(view: Size, base: Size, v: View, overscroll = 0): View {
  return {
    zoom: v.zoom,
    tx: clampAxis(v.tx, view.w, base.w * v.zoom, overscroll),
    ty: clampAxis(v.ty, view.h, base.h * v.zoom, overscroll),
  };
}

/** Zoom to `newZoom` keeping the content point under `p` fixed. */
export function zoomAround(view: Size, base: Size, v: View, p: Point, newZoom: number): View {
  const z = clampZoom(newZoom);
  const lx = (p.x - v.tx) / v.zoom;
  const ly = (p.y - v.ty) / v.zoom;
  return clampPan(view, base, { zoom: z, tx: p.x - lx * z, ty: p.y - ly * z });
}

export function initialView(view: Size, base: Size, direction: Direction): View {
  const tx = base.w > view.w ? (direction === 'rtl' ? view.w - base.w : 0) : (view.w - base.w) / 2;
  const ty = base.h > view.h ? 0 : (view.h - base.h) / 2;
  return { zoom: 1, tx, ty };
}

/** Visible region in base-layer CSS px (pre-zoom coordinates). */
export function visibleRect(view: Size, v: View): { x: number; y: number; w: number; h: number } {
  return { x: -v.tx / v.zoom, y: -v.ty / v.zoom, w: view.w / v.zoom, h: view.h / v.zoom };
}

/** True when the content can still be dragged in the given direction on that axis. */
export function canPan(view: Size, base: Size, v: View, axis: 'x' | 'y', sign: 1 | -1): boolean {
  const content = (axis === 'x' ? base.w : base.h) * v.zoom;
  const viewDim = axis === 'x' ? view.w : view.h;
  if (content <= viewDim + 0.5) return false;
  const t = axis === 'x' ? v.tx : v.ty;
  // dragging right/down (sign +1) moves content positive: possible while t < 0
  return sign > 0 ? t < -0.5 : t > viewDim - content + 0.5;
}

/** Pinch: new zoom from the ratio of finger distances. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return startZoom;
  return clampZoom(startZoom * (dist / startDist));
}

export function isZoomed(v: View): boolean {
  return v.zoom > 1.02;
}
