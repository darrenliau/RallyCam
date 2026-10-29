/**
 * First attempt at following the shuttle: look for small things that move fast. The Swift version in
 * modules/rallycam-export/ios/ShuttleTracker.swift does the same thing on the camera's luma plane, with the same numbers.
 * This TypeScript copy exists so the method can be tested with made-up frames, and so logs from the phone can be replayed.
 *
 * How it works, per frame:
 *  1. Keep the pixels that changed since the last frame AND since the frame before. A small object that moves a lot shows up
 *     in both differences exactly where it was in the middle frame. Static things and slow things do not.
 *  2. Group the changed pixels into blobs and keep the small ones. People and rackets make big blobs.
 *  3. Chain blobs from frame to frame into a path that moves smoothly and fast. Three matching frames in a row confirm a track.
 */

export interface Candidate {
  x: number;
  y: number;
  /** Changed pixels in the blob. */
  area: number;
  /** Average brightness change of those pixels. */
  contrast: number;
}

export interface MotionOptions {
  diffThreshold: number;
  cellSize: number;
  minArea: number;
  maxArea: number;
  /** Longest side of a blob, in pixels. */
  maxSize: number;
  /** Furthest a blob may move between two analysed frames and still be the same shuttle. */
  gate: number;
  /** Least a blob must move between frames to count (static noise should not chain). */
  minStep: number;
  confirmHits: number;
  maxMisses: number;
  /** If more than this share of the picture changed, the phone shook or the lights flickered: skip the frame. */
  shakeFraction: number;
  maxCandidates: number;
}

export const DEFAULT_MOTION: MotionOptions = {
  diffThreshold: 24,
  cellSize: 4,
  minArea: 3,
  maxArea: 260,
  maxSize: 36,
  gate: 220,
  minStep: 6,
  confirmHits: 3,
  maxMisses: 8,
  shakeFraction: 0.03,
  maxCandidates: 12,
};

export interface Track {
  x: number;
  y: number;
  /** Pixels per second. */
  vx: number;
  vy: number;
  hits: number;
  misses: number;
  confirmed: boolean;
  /** Time of the latest position, in seconds. */
  t: number;
}

export interface MotionResult {
  candidates: Candidate[];
  track?: Track;
  /** Share of pixels that changed in both differences. */
  activeFraction: number;
  shaky: boolean;
}

interface Seed { x: number; y: number; t: number; vx: number; vy: number; hits: number }

export class MotionShuttleTracker {
  private prev: Uint8Array | null = null;
  private prev2: Uint8Array | null = null;
  private prevT = 0;
  private track: Track | undefined;
  private seeds: Seed[] = [];
  private o: MotionOptions;

  constructor(options: Partial<MotionOptions> = {}) {
    this.o = { ...DEFAULT_MOTION, ...options };
  }

  reset() {
    this.prev = this.prev2 = null;
    this.track = undefined;
    this.seeds = [];
  }

  /** `luma` is the brightness of the area to watch, one byte per pixel, `w` x `h`. `t` is its time in seconds. */
  update(luma: Uint8Array, w: number, h: number, t: number): MotionResult {
    const prev = this.prev;
    const prev2 = this.prev2;
    const obsT = this.prevT; // the blob found now is where the shuttle was in the middle frame
    this.prev2 = prev;
    this.prev = luma.slice();
    this.prevT = t;
    if (!prev || !prev2 || prev.length !== luma.length || prev2.length !== luma.length) {
      return { candidates: [], track: this.track, activeFraction: 0, shaky: false };
    }

    const o = this.o;
    const cs = o.cellSize;
    const cw = Math.ceil(w / cs);
    const ch = Math.ceil(h / cs);
    const cellCount = new Uint16Array(cw * ch);
    const cellDiff = new Uint32Array(cw * ch);
    let active = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const cellRow = Math.floor(y / cs) * cw;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const d1 = Math.abs(luma[i] - prev[i]);
        if (d1 <= o.diffThreshold) continue;
        if (Math.abs(prev[i] - prev2[i]) <= o.diffThreshold) continue;
        active++;
        const c = cellRow + Math.floor(x / cs);
        cellCount[c]++;
        cellDiff[c] += d1;
      }
    }

    const activeFraction = active / (w * h);
    if (activeFraction > o.shakeFraction) {
      this.miss();
      return { candidates: [], track: this.track, activeFraction, shaky: true };
    }

    const candidates = this.blobs(cellCount, cellDiff, cw, ch);
    this.follow(candidates, obsT);
    return { candidates, track: this.track, activeFraction, shaky: false };
  }

  private blobs(count: Uint16Array, diff: Uint32Array, cw: number, ch: number): Candidate[] {
    const o = this.o;
    const cs = o.cellSize;
    const seen = new Uint8Array(cw * ch);
    const out: Candidate[] = [];
    const stack: number[] = [];
    for (let start = 0; start < count.length; start++) {
      if (count[start] < 2 || seen[start]) continue;
      let area = 0;
      let sumDiff = 0;
      let sx = 0;
      let sy = 0;
      let minX = cw, maxX = 0, minY = ch, maxY = 0;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % cw;
        const cy = (c - cx) / cw;
        area += count[c];
        sumDiff += diff[c];
        sx += (cx + 0.5) * count[c];
        sy += (cy + 0.5) * count[c];
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const n of [c - 1, c + 1, c - cw, c + cw]) {
          if (n < 0 || n >= count.length || seen[n] || count[n] < 2) continue;
          if ((n === c - 1 && cx === 0) || (n === c + 1 && cx === cw - 1)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const size = Math.max(maxX - minX + 1, maxY - minY + 1) * cs;
      if (area < o.minArea || area > o.maxArea || size > o.maxSize) continue;
      out.push({ x: (sx / area) * cs, y: (sy / area) * cs, area, contrast: sumDiff / area });
    }
    out.sort((a, b) => b.contrast * b.area - a.contrast * a.area);
    return out.slice(0, o.maxCandidates);
  }

  private miss() {
    if (!this.track) { this.seeds = []; return; }
    this.track = { ...this.track, misses: this.track.misses + 1 };
    if (this.track.misses > this.o.maxMisses) this.track = undefined;
  }

  private follow(cands: Candidate[], t: number) {
    const o = this.o;
    if (this.track) {
      const tr = this.track;
      const dt = Math.max(1e-3, t - tr.t);
      const px = tr.x + tr.vx * dt;
      const py = tr.y + tr.vy * dt;
      let best: Candidate | undefined;
      let bestD = Infinity;
      for (const c of cands) {
        const d = Math.hypot(c.x - px, c.y - py);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best && bestD <= o.gate * 0.6 + tr.misses * 20) {
        const vx = (best.x - tr.x) / dt;
        const vy = (best.y - tr.y) / dt;
        this.track = { x: best.x, y: best.y, vx: 0.6 * vx + 0.4 * tr.vx, vy: 0.6 * vy + 0.4 * tr.vy, hits: tr.hits + 1, misses: 0, confirmed: true, t };
      } else {
        this.miss();
      }
      return;
    }

    // no track yet: grow short chains of blobs that move the same way
    const next: Seed[] = [];
    const used = new Set<number>();
    for (const s of this.seeds) {
      const dt = Math.max(1e-3, t - s.t);
      let best = -1;
      let bestScore = Infinity;
      cands.forEach((c, i) => {
        if (used.has(i)) return;
        const dx = c.x - s.x;
        const dy = c.y - s.y;
        const step = Math.hypot(dx, dy);
        if (step < o.minStep || step > o.gate) return;
        if (s.hits >= 2) {
          const sv = Math.hypot(s.vx, s.vy) * dt;
          if (step < 0.4 * sv || step > 2.5 * sv) return; // speed must stay about the same
          if ((dx * s.vx + dy * s.vy) <= 0.5 * step * Math.hypot(s.vx, s.vy)) return; // direction must stay within ~60 degrees
        }
        const score = s.hits >= 2 ? Math.hypot(c.x - (s.x + s.vx * dt), c.y - (s.y + s.vy * dt)) : step;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) {
        used.add(best);
        const c = cands[best];
        const seed: Seed = { x: c.x, y: c.y, t, vx: (c.x - s.x) / dt, vy: (c.y - s.y) / dt, hits: s.hits + 1 };
        if (seed.hits >= o.confirmHits) {
          this.track = { x: seed.x, y: seed.y, vx: seed.vx, vy: seed.vy, hits: seed.hits, misses: 0, confirmed: true, t };
          this.seeds = [];
          return;
        }
        next.push(seed);
      }
    }
    cands.forEach((c, i) => {
      if (!used.has(i) && next.length < 24) next.push({ x: c.x, y: c.y, t, vx: 0, vy: 0, hits: 1 });
    });
    this.seeds = next;
  }
}
