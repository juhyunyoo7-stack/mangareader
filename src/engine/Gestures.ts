import type { Point } from './Viewport.ts';

export interface GestureHandlers {
  onTap(p: Point, e: PointerEvent): void;
  onDoubleTap(p: Point): void;
  onLongPress(p: Point): void;
  /** incremental drag (single pointer) */
  onDrag(dx: number, dy: number, p: Point, pointerType: string): void;
  onDragEnd(total: {
    dx: number;
    dy: number;
    dt: number;
    pointerType: string;
    button: number;
  }): void;
  /** incremental pinch: ratio vs previous event, plus focal point and its movement */
  onPinch(ratio: number, center: Point, panDx: number, panDy: number): void;
  onPinchEnd(): void;
  onWheel(e: WheelEvent): void;
  /** returns true if the tap should wait for a possible double tap */
  deferTap?(p: Point): boolean;
}

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  type: string;
  button: number;
}

const MOVE_SLOP = 8;
const TAP_MAX_MS = 350;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_DIST = 40;
const LONG_PRESS_MS = 550;

/** Pointer-events gesture recogniser: tap, double tap, long press, drag, pinch, wheel. */
export class Gestures {
  private ptrs = new Map<number, Ptr>();
  private mode: 'idle' | 'tap' | 'drag' | 'pinch' = 'idle';
  private lastTap: { t: number; p: Point } | null = null;
  private pendingTap: number | null = null;
  private longTimer: number | null = null;
  private pinchLast: { dist: number; cx: number; cy: number } | null = null;
  private dragTotal = { dx: 0, dy: 0 };
  private startT = 0;
  private startButton = 0;
  private startType = 'mouse';
  private longFired = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly h: GestureHandlers,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.context);
    el.addEventListener('dblclick', this.prevent);
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('wheel', this.wheel);
    this.el.removeEventListener('contextmenu', this.context);
    this.el.removeEventListener('dblclick', this.prevent);
    this.clearTimers();
  }

  private prevent = (e: Event) => e.preventDefault();

  private pt(e: PointerEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private clearTimers(): void {
    if (this.longTimer !== null) clearTimeout(this.longTimer);
    if (this.pendingTap !== null) clearTimeout(this.pendingTap);
    this.longTimer = null;
    this.pendingTap = null;
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    this.el.setPointerCapture?.(e.pointerId);
    const p = this.pt(e);
    this.ptrs.set(e.pointerId, {
      x: p.x,
      y: p.y,
      sx: p.x,
      sy: p.y,
      t: performance.now(),
      type: e.pointerType,
      button: e.button,
    });
    if (this.ptrs.size === 1) {
      this.mode = 'tap';
      this.dragTotal = { dx: 0, dy: 0 };
      this.startT = performance.now();
      this.startButton = e.button;
      this.startType = e.pointerType;
      this.longFired = false;
      if (e.button === 0) {
        this.longTimer = window.setTimeout(() => {
          if (this.mode === 'tap') {
            this.longFired = true;
            this.h.onLongPress(p);
          }
        }, LONG_PRESS_MS);
      }
    } else if (this.ptrs.size === 2) {
      if (this.longTimer !== null) clearTimeout(this.longTimer);
      this.mode = 'pinch';
      this.pinchLast = this.pinchMetrics();
    }
  };

  private pinchMetrics() {
    const [a, b] = [...this.ptrs.values()];
    return {
      dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      cx: (a!.x + b!.x) / 2,
      cy: (a!.y + b!.y) / 2,
    };
  }

  private move = (e: PointerEvent) => {
    const s = this.ptrs.get(e.pointerId);
    if (!s) return;
    const p = this.pt(e);
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    s.x = p.x;
    s.y = p.y;
    if (this.mode === 'pinch' && this.ptrs.size >= 2 && this.pinchLast) {
      const m = this.pinchMetrics();
      const ratio = this.pinchLast.dist > 0 ? m.dist / this.pinchLast.dist : 1;
      this.h.onPinch(
        ratio,
        { x: m.cx, y: m.cy },
        m.cx - this.pinchLast.cx,
        m.cy - this.pinchLast.cy,
      );
      this.pinchLast = m;
      return;
    }
    if (this.mode === 'tap') {
      if (Math.hypot(p.x - s.sx, p.y - s.sy) > MOVE_SLOP) {
        this.mode = 'drag';
        if (this.longTimer !== null) clearTimeout(this.longTimer);
        // account for the movement accumulated before the slop was exceeded
        this.dragTotal = { dx: p.x - s.sx, dy: p.y - s.sy };
        this.h.onDrag(p.x - s.sx, p.y - s.sy, p, s.type);
      }
      return;
    }
    if (this.mode === 'drag') {
      this.dragTotal.dx += dx;
      this.dragTotal.dy += dy;
      this.h.onDrag(dx, dy, p, s.type);
    }
  };

  private up = (e: PointerEvent) => {
    const s = this.ptrs.get(e.pointerId);
    if (!s) return;
    const p = this.pt(e);
    this.ptrs.delete(e.pointerId);
    if (this.mode === 'pinch') {
      if (this.ptrs.size < 2) {
        this.h.onPinchEnd();
        this.mode = 'idle';
        this.ptrs.clear();
      }
      return;
    }
    if (this.longTimer !== null) clearTimeout(this.longTimer);
    if (this.mode === 'drag') {
      this.mode = 'idle';
      this.h.onDragEnd({
        dx: this.dragTotal.dx,
        dy: this.dragTotal.dy,
        dt: performance.now() - this.startT,
        pointerType: this.startType,
        button: this.startButton,
      });
      return;
    }
    if (this.mode === 'tap') {
      this.mode = 'idle';
      if (this.longFired || performance.now() - s.t > TAP_MAX_MS * 2 || this.startButton !== 0)
        return;
      this.registerTap(p, e);
    }
  };

  private registerTap(p: Point, e: PointerEvent): void {
    const now = performance.now();
    const prev = this.lastTap;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DOUBLE_TAP_DIST
    ) {
      if (this.pendingTap !== null) clearTimeout(this.pendingTap);
      this.pendingTap = null;
      this.lastTap = null;
      this.h.onDoubleTap(p);
      return;
    }
    this.lastTap = { t: now, p };
    if (this.h.deferTap?.(p)) {
      this.pendingTap = window.setTimeout(() => {
        this.pendingTap = null;
        this.lastTap = null;
        this.h.onTap(p, e);
      }, DOUBLE_TAP_MS);
    } else {
      this.h.onTap(p, e);
    }
  }

  private cancel = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.longTimer !== null) clearTimeout(this.longTimer);
    if (this.mode === 'pinch') this.h.onPinchEnd();
    if (this.ptrs.size === 0) this.mode = 'idle';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.h.onWheel(e);
  };

  private context = (e: MouseEvent) => {
    e.preventDefault();
    if (this.longFired && performance.now() - this.startT < 1500) return; // already handled by the timer
    const r = this.el.getBoundingClientRect();
    this.h.onLongPress({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
}
