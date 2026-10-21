// Frame-rate monitor: call tick(now) once per animation frame. It costs one subtraction per frame and refreshes its
// figures twice a second. The FPS overlay reads `fps` / `frameMs` / `worstMs`; analytics reads `drain()` for an average.

export class PerfMonitor {
  constructor(windowMs = 500) {
    this.windowMs = windowMs;
    this.last = 0;
    this.start = 0;
    this.frames = 0;
    this.worst = 0;
    this.fps = 0; // frames per second over the last window
    this.frameMs = 0; // average frame time over the last window
    this.worstMs = 0; // slowest single frame in the last window
    this.acc = { sum: 0, n: 0, min: Infinity }; // since the last drain()
  }

  tick(now) {
    if (this.last) {
      const dt = now - this.last;
      // a background tab or a debugger pause is not a slow frame — ignore gaps longer than a second
      if (dt < 1000) {
        this.frames++;
        if (dt > this.worst) this.worst = dt;
      } else this.start = now;
    } else this.start = now;
    this.last = now;
    const span = now - this.start;
    if (span >= this.windowMs && this.frames > 0) {
      this.fps = (this.frames * 1000) / span;
      this.frameMs = span / this.frames;
      this.worstMs = this.worst;
      this.acc.sum += this.fps;
      this.acc.n++;
      if (this.fps < this.acc.min) this.acc.min = this.fps;
      this.frames = 0;
      this.worst = 0;
      this.start = now;
    }
  }

  /** Average and lowest FPS since the previous call (null if nothing was drawn), then start afresh. */
  drain() {
    const { sum, n, min } = this.acc;
    this.acc = { sum: 0, n: 0, min: Infinity };
    return n ? { avg: sum / n, min } : null;
  }
}
