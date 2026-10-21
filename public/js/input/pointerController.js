// Unified pointer input — one code path for mouse, touch and pen (Pointer Events).
//
// Fixes the classic double-fire bug (touchend + emulated mouse events both "clicking"), and gives every
// platform the same vocabulary:
//   tap      press+release without travelling (primary action)       { sx, sy, pointerType }
//   hover    mouse/pen movement with no button down                   { sx, sy }
//   pan      dragging with 1 pointer (or 2-finger midpoint)           (dx, dy)
//   zoom     wheel, trackpad pinch, 2-finger pinch                    (factor, sx, sy)
//   cancel   right click / Escape                                     ()
//   paint    left-drag while `isPainting()` (map editor)              { sx, sy, first }
// All coordinates are device pixels relative to the element's top-left.

const SLOP = { mouse: 5, pen: 6, touch: 11 };

export class PointerController {
  /**
   * @param {HTMLElement} el
   * @param {object} h handlers: { onTap,onHover,onPan,onZoom,onCancel,onPaint,isPainting,onGestureStart,onLeave }
   */
  constructor(el, handlers = {}) {
    this.el = el;
    this.h = handlers;
    this.pointers = new Map();
    this.gesture = null; // { dist, mid }
    this.suppressTap = false;
    this.dpr = window.devicePixelRatio || 1;
    this.bind();
  }

  setDpr(dpr) {
    this.dpr = dpr;
  }

  point(e) {
    const r = this.el.getBoundingClientRect();
    return { sx: (e.clientX - r.left) * this.dpr, sy: (e.clientY - r.top) * this.dpr };
  }

  bind() {
    const el = this.el;
    el.style.touchAction = 'none';
    this._down = e => this.down(e);
    this._move = e => this.move(e);
    this._up = e => this.up(e);
    this._cancel = e => this.cancel(e);
    this._wheel = e => this.wheel(e);
    this._ctx = e => e.preventDefault();
    this._leave = () => this.h.onLeave?.();
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._cancel);
    el.addEventListener('pointerleave', this._leave);
    el.addEventListener('wheel', this._wheel, { passive: false });
    el.addEventListener('contextmenu', this._ctx);
  }

  destroy() {
    const el = this.el;
    el.removeEventListener('pointerdown', this._down);
    el.removeEventListener('pointermove', this._move);
    el.removeEventListener('pointerup', this._up);
    el.removeEventListener('pointercancel', this._cancel);
    el.removeEventListener('pointerleave', this._leave);
    el.removeEventListener('wheel', this._wheel);
    el.removeEventListener('contextmenu', this._ctx);
  }

  down(e) {
    const p = this.point(e);
    if (e.pointerType === 'mouse' && e.button === 2) {
      this.h.onCancel?.();
      return;
    }
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch (_) {
      /* some browsers throw for synthetic pointers */
    }
    this.pointers.set(e.pointerId, {
      ...p,
      startX: p.sx,
      startY: p.sy,
      type: e.pointerType,
      button: e.button,
      moved: false,
      painting: false
    });

    if (this.pointers.size === 2) {
      this.suppressTap = true;
      this.gesture = this.measure();
      this.h.onGestureStart?.();
    } else if (this.pointers.size === 1) {
      this.suppressTap = false;
      if (e.pointerType === 'mouse' && e.button === 0 && this.h.isPainting?.()) {
        const ptr = this.pointers.get(e.pointerId);
        ptr.painting = true;
        this.h.onPaint?.({ ...p, first: true });
      }
    }
  }

  move(e) {
    const p = this.point(e);
    const ptr = this.pointers.get(e.pointerId);

    if (!ptr) {
      if (e.pointerType !== 'touch') this.h.onHover?.(p);
      return;
    }

    const prevX = ptr.sx;
    const prevY = ptr.sy;
    ptr.sx = p.sx;
    ptr.sy = p.sy;

    if (this.pointers.size >= 2) {
      this.updateGesture();
      return;
    }

    if (e.pointerType !== 'touch') this.h.onHover?.(p);

    if (ptr.painting) {
      this.h.onPaint?.({ ...p, first: false });
      ptr.moved = true;
      return;
    }

    const slop = (SLOP[ptr.type] || 6) * this.dpr;
    if (!ptr.moved && Math.hypot(p.sx - ptr.startX, p.sy - ptr.startY) > slop) {
      ptr.moved = true;
      this.suppressTap = true;
      this.el.classList.add('is-panning');
      this.h.onGestureStart?.();
    }
    if (ptr.moved) this.h.onPan?.(p.sx - prevX, p.sy - prevY);
  }

  up(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    this.el.classList.remove('is-panning');
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }
    if (this.pointers.size < 2) this.gesture = null;

    const wasTap = !ptr.moved && !ptr.painting && !this.suppressTap && ptr.button === 0 && this.pointers.size === 0;
    if (this.pointers.size === 0) this.suppressTap = false;
    if (wasTap) this.h.onTap?.({ sx: ptr.sx, sy: ptr.sy, pointerType: ptr.type });
  }

  cancel(e) {
    this.pointers.delete(e.pointerId);
    this.gesture = null;
    this.suppressTap = this.pointers.size > 0;
    this.el.classList.remove('is-panning');
  }

  measure() {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1,
      mx: (a.sx + b.sx) / 2,
      my: (a.sy + b.sy) / 2
    };
  }

  updateGesture() {
    if (!this.gesture) return;
    const now = this.measure();
    const factor = now.dist / this.gesture.dist;
    this.h.onPan?.(now.mx - this.gesture.mx, now.my - this.gesture.my);
    if (Math.abs(factor - 1) > 0.015) {
      this.h.onZoom?.(factor, now.mx, now.my);
      this.gesture.dist = now.dist;
    }
    this.gesture.mx = now.mx;
    this.gesture.my = now.my;
  }

  wheel(e) {
    e.preventDefault();
    const p = this.point(e);
    // trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send ±100
    const mag = e.ctrlKey ? Math.min(Math.abs(e.deltaY) * 0.012, 0.25) : 0.14;
    this.h.onZoom?.(e.deltaY < 0 ? 1 + mag : 1 / (1 + mag), p.sx, p.sy);
  }
}
