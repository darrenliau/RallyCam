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

import { looksLikeFlight, type PathPoint } from './shuttlePath';

/** A rectangle in the pixels of the area being watched. */
export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where a player is, widened to cover the arms and racket. Movement inside these boxes is the player, not the shuttle:
 * it does not count towards "the picture shook", and blobs inside it cannot start a new track (an existing track can still pass through).
 */
export function playerMask(person: Box, bounds: { w: number; h: number }): Box {
  const x0 = Math.max(0, person.x - 0.5 * person.w);
  const x1 = Math.min(bounds.w, person.x + 1.5 * person.w);
  const y0 = Math.max(0, person.y - 0.25 * person.h);
  const y1 = Math.min(bounds.h, person.y + 1.05 * person.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export interface Candidate {
  x: number;
  y: number;
  /** Changed pixels in the blob. */
  area: number;
  /** Average brightness change of those pixels. */
  contrast: number;
  /** Inside a player's box: probably a hand, a racket or a foot. */
  inPlayer?: boolean;
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
  /** A blob that keeps turning up within this many pixels of the same place is background (a flickering light, a screen), not a shuttle. */
  hotRadius: number;
  hotFrames: number;
  hotCount: number;
  /** No flight lasts this long, so a track older than this is dropped and the search starts again. */
  maxTrackAge: number;
  /** A frame with this many candidates or more is crowded (a flickering screen, a patterned floor): no new track may start from it. */
  crowdedCount: number;
  /** The picture is divided into squares of this many pixels to learn which places keep flickering. */
  activityBin: number;
  /** How much a candidate in a square raises that square's activity, and how fast it fades (per frame). */
  activityRise: number;
  activityDecay: number;
  /** A candidate in or next to a square this active is background. A shuttle crosses a square in a frame or two and never reaches this. */
  activityLimit: number;
  /** A track is dropped when its last `pathWindow` positions do not fit a smooth curve (see shuttlePath.ts). 0 turns the check off. */
  pathWindow: number;
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
  shakeFraction: 0.012,
  maxCandidates: 12,
  hotRadius: 14,
  hotFrames: 10,
  hotCount: 4,
  maxTrackAge: 1.2,
  crowdedCount: 10,
  activityBin: 24,
  activityRise: 0.03,
  activityDecay: 0.01,
  activityLimit: 0.06,
  pathWindow: 10,
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
  /** When the track was confirmed. */
  born: number;
}

export interface MotionResult {
  candidates: Candidate[];
  track?: Track;
  /** Share of pixels that changed in both differences. */
  activeFraction: number;
  shaky: boolean;
}

interface Seed { x: number; y: number; t: number; vx: number; vy: number; hits: number; path: PathPoint[] }

export class MotionShuttleTracker {
  private prev: Uint8Array | null = null;
  private prev2: Uint8Array | null = null;
  private prevT = 0;
  private track: Track | undefined;
  private seeds: Seed[] = [];
  private recent: Candidate[][] = [];
  private maskHistory: Box[][] = [];
  private activity = new Float32Array(0);
  private path: PathPoint[] = [];
  private bins = { w: 0, h: 0 };
  private o: MotionOptions;

  constructor(options: Partial<MotionOptions> = {}) {
    this.o = { ...DEFAULT_MOTION, ...options };
  }

  reset() {
    this.prev = this.prev2 = null;
    this.track = undefined;
    this.seeds = [];
    this.recent = [];
    this.maskHistory = [];
    this.activity = new Float32Array(0);
    this.path = [];
  }

  /** `luma` is the brightness of the area to watch, one byte per pixel, `w` x `h`. `t` is its time in seconds. */
  update(luma: Uint8Array, w: number, h: number, t: number, masks: Box[] = []): MotionResult {
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
    // The change between frames also shows where a player was a moment ago, so keep the last few positions of each mask
    this.maskHistory.push(masks);
    if (this.maskHistory.length > 3) this.maskHistory.shift();
    const covered = new Uint8Array(cw * ch);
    for (const m of this.maskHistory.flat()) {
      for (let cy = Math.max(0, Math.floor(m.y / cs)); cy <= Math.min(ch - 1, Math.floor((m.y + m.h) / cs)); cy++) {
        for (let cx = Math.max(0, Math.floor(m.x / cs)); cx <= Math.min(cw - 1, Math.floor((m.x + m.w) / cs)); cx++) covered[cy * cw + cx] = 1;
      }
    }
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
        const c = cellRow + Math.floor(x / cs);
        if (!covered[c]) active++; // players moving must not make the picture look shaken
        cellCount[c]++;
        cellDiff[c] += d1;
      }
    }

    const activeFraction = active / (w * h);
    if (activeFraction > o.shakeFraction) {
      this.miss();
      return { candidates: [], track: this.track, activeFraction, shaky: true };
    }

    const found = this.blobs(cellCount, cellDiff, cw, ch, covered);
    // A track already being followed may pass over a flickering place, so the learned background only filters while looking for a new one
    const cleaned = this.dropBusy(found, w, h);
    const candidates = this.dropBackground(this.track ? found : cleaned);
    this.follow(candidates, obsT, candidates.length >= o.crowdedCount);
    return { candidates, track: this.track, activeFraction, shaky: false };
  }

  private blobs(count: Uint16Array, diff: Uint32Array, cw: number, ch: number, covered: Uint8Array): Candidate[] {
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
      const cxm = Math.min(cw - 1, Math.floor(sx / area));
      const cym = Math.min(ch - 1, Math.floor(sy / area));
      const inPlayer = covered[cym * cw + cxm] === 1;
      out.push({ x: (sx / area) * cs, y: (sy / area) * cs, area, contrast: sumDiff / area, ...(inPlayer ? { inPlayer } : {}) });
    }
    // blobs on a player come last, so they do not crowd the shuttle out of the list
    const score = (c: Candidate) => c.contrast * c.area * (c.inPlayer ? 0.25 : 1);
    out.sort((a, b) => score(b) - score(a));
    return out.slice(0, o.maxCandidates);
  }

  /**
   * Learns which squares of the picture keep producing candidates (flicker, a screen, a patterned floor) and drops candidates there.
   * Only learns while there is no track, so the shuttle being followed cannot teach it that its own path is background.
   */
  private dropBusy(found: Candidate[], w: number, h: number): Candidate[] {
    const o = this.o;
    const bw = Math.ceil(w / o.activityBin);
    const bh = Math.ceil(h / o.activityBin);
    if (this.bins.w !== bw || this.bins.h !== bh) {
      this.bins = { w: bw, h: bh };
      this.activity = new Float32Array(bw * bh);
    }
    const act = this.activity;
    const keep = found.filter((c) => {
      const bx = Math.floor(c.x / o.activityBin);
      const by = Math.floor(c.y / o.activityBin);
      let m = 0;
      for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) {
        if (i >= 0 && j >= 0 && i < bw && j < bh) m = Math.max(m, act[j * bw + i]);
      }
      return m < o.activityLimit;
    });
    const keepFading = 1 - o.activityDecay;
    for (let i = 0; i < act.length; i++) act[i] *= keepFading;
    if (!this.track) {
      for (const c of found) {
        if (c.inPlayer) continue; // players move around a lot; they are handled by the player boxes
        const bx = Math.min(bw - 1, Math.max(0, Math.floor(c.x / o.activityBin)));
        const by = Math.min(bh - 1, Math.max(0, Math.floor(c.y / o.activityBin)));
        act[by * bw + bx] = Math.min(1, act[by * bw + bx] + o.activityRise);
      }
    }
    return keep;
  }

  /** Remove blobs that have been at about the same spot in several of the last few frames. */
  private dropBackground(found: Candidate[]): Candidate[] {
    const o = this.o;
    const keep = found.filter((c) => {
      let n = 0;
      for (const frame of this.recent) if (frame.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < o.hotRadius)) n++;
      return n < o.hotCount;
    });
    this.recent.push(found);
    if (this.recent.length > o.hotFrames) this.recent.shift();
    return keep;
  }

  private miss() {
    if (!this.track) { this.seeds = []; return; }
    this.track = { ...this.track, misses: this.track.misses + 1 };
    if (this.track.misses > this.o.maxMisses) this.track = undefined;
  }

  private follow(cands: Candidate[], t: number, crowded: boolean) {
    const o = this.o;
    if (this.track) {
      const tr = this.track;
      if (t - tr.born > o.maxTrackAge) { this.track = undefined; this.seeds = []; return; }
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
        this.path.push({ t, x: best.x, y: best.y });
        if (this.path.length > o.pathWindow) this.path.shift();
        if (o.pathWindow > 0 && !looksLikeFlight(this.path)) {
          // hopping between unrelated specks, not a flight: forget it and look again
          this.track = undefined;
          this.seeds = [];
          this.path = [];
          return;
        }
        this.track = { x: best.x, y: best.y, vx: 0.6 * vx + 0.4 * tr.vx, vy: 0.6 * vy + 0.4 * tr.vy, hits: tr.hits + 1, misses: 0, confirmed: true, t, born: tr.born };
      } else {
        this.miss();
      }
      return;
    }

    // no track yet: grow short chains of blobs that move the same way. Blobs on a player never start one, and neither does a crowded frame.
    if (crowded) { this.seeds = []; return; }
    const free = cands.filter((c) => !c.inPlayer);
    const next: Seed[] = [];
    const used = new Set<number>();
    for (const s of this.seeds) {
      const dt = Math.max(1e-3, t - s.t);
      let best = -1;
      let bestScore = Infinity;
      free.forEach((c, i) => {
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
        const c = free[best];
        const seed: Seed = { x: c.x, y: c.y, t, vx: (c.x - s.x) / dt, vy: (c.y - s.y) / dt, hits: s.hits + 1, path: [...s.path, { t, x: c.x, y: c.y }].slice(-o.pathWindow) };
        if (seed.hits >= o.confirmHits) {
          this.path = seed.path;
          this.track = { x: seed.x, y: seed.y, vx: seed.vx, vy: seed.vy, hits: seed.hits, misses: 0, confirmed: true, t, born: t };
          this.seeds = [];
          return;
        }
        next.push(seed);
      }
    }
    free.forEach((c, i) => {
      if (!used.has(i) && next.length < 24) next.push({ x: c.x, y: c.y, t, vx: 0, vy: 0, hits: 1, path: [{ t, x: c.x, y: c.y }] });
    });
    this.seeds = next;
  }
}
