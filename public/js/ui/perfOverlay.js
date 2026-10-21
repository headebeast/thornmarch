// On-screen performance read-out: frame rate always (when enabled), connection quality while an online room is open.
// It is a few text nodes refreshed twice a second and never takes a click.

import { h } from './dom.js';

const mark = q => (q === 'good' ? 'ok' : q === 'fair' ? 'warn' : q === 'poor' ? 'bad' : '');

export class PerfOverlay {
  /**
   * @param {{perf: import('../platform/perfMonitor.js').PerfMonitor, getNet: () => import('../network/netStats.js').NetStats | null,
   *          isOnline: () => boolean, anchor: () => HTMLElement | null}} o
   */
  constructor({ perf, getNet, isOnline, anchor }) {
    this.perf = perf;
    this.getNet = getNet;
    this.isOnline = isOnline;
    this.anchor = anchor;
    this.showFps = false;
    this.showNet = false;
    this.fpsLine = h('div', { class: 'perf-line' });
    this.netLine = h('div', { class: 'perf-line' });
    this.node = h('div', { class: 'perf-overlay hidden', 'aria-hidden': 'true' }, this.fpsLine, this.netLine);
    document.body.appendChild(this.node);
    this.nextAt = 0;
  }

  configure({ showFps, showNet }) {
    this.showFps = !!showFps;
    this.showNet = !!showNet;
    this.nextAt = 0;
    this.render(performance.now());
  }

  /** Call every animation frame (cheap: returns at once unless it is time to redraw). */
  tick(now) {
    if (now >= this.nextAt) this.render(now);
  }

  render(now) {
    this.nextAt = now + 500;
    const online = this.showNet && this.isOnline();
    const visible = this.showFps || online;
    this.node.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.fpsLine.style.display = this.showFps ? '' : 'none';
    if (this.showFps) {
      const { fps, frameMs, worstMs } = this.perf;
      const q = fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad';
      this.fpsLine.className = `perf-line ${q}`;
      this.fpsLine.textContent = fps ? `${Math.round(fps)} FPS · ${frameMs.toFixed(1)} ms · worst ${Math.round(worstMs)} ms` : 'FPS …';
    }
    this.netLine.style.display = online ? '' : 'none';
    if (online) {
      const s = this.getNet()?.snapshot(now);
      if (!s || s.ping === null) {
        this.netLine.className = 'perf-line';
        this.netLine.textContent = 'Ping … (measuring)';
      } else {
        this.netLine.className = `perf-line ${s.silent ? 'bad' : mark(s.quality)}`;
        this.netLine.textContent = s.silent ? 'Connection stalled — no reply' : `Ping ${Math.round(s.ping)} ms · jitter ${s.jitter === null ? '–' : Math.round(s.jitter)} ms · loss ${s.loss < 10 ? s.loss.toFixed(1) : Math.round(s.loss)}%`;
      }
    }
    // sit just under the game's top bar, wherever it wrapped to
    const top = this.anchor()?.getBoundingClientRect();
    this.node.style.top = `${Math.round((top && top.height ? top.bottom : 0) + 6)}px`;
  }
}
