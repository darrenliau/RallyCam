import { COURT_L, COURT_W } from './court';
import type { ShuttleStats } from './shuttle';
import type { FloorPoint, RallyTrace } from './rallyEnd';

/** A confirmed shuttle position from the camera. x and y are fractions of the frame, t is in seconds. */
export interface ShuttleSample { t: number; x: number; y: number }

/** Plausible shuttle speeds only. Beyond this the track jumped to something else. */
const MAX_SPEED_MS = 150;
/** After this long without a sample the shuttle is considered gone. */
const GONE_AFTER_S = 1.2;
/** Two hits are never closer than this. */
const MIN_HIT_GAP_S = 0.25;

/**
 * Turns the shuttle path into the numbers on the cards: a rough speed and a count of shots.
 *
 * Speed is an estimate and a poor one. The shuttle is in the air but the court map only knows about the floor, so the
 * image position is treated as a floor point. The result is about right for a shuttle low over the floor and too high
 * for one high above it. That is why the cards say "estimate".
 *
 * A shot is counted when the shuttle turns around (its direction on screen reverses), and for the first appearance of a rally.
 */
export class ShuttleEstimator {
  private last: (ShuttleSample & { u: number; v: number }) | null = null;
  private prevVel: { x: number; y: number } | null = null;
  private lastHitT = -Infinity;
  private shots = 0;
  private peakKmh = 0;
  private lastShotKmh = 0;
  private smoothMs = 0;
  private seen = false;
  private recent: ShuttleSample[] = [];
  private hit: FloorPoint | null = null;

  /** `toFloor` maps a frame position to court coordinates (0..1 across and along the court). */
  constructor(private toFloor: (x: number, y: number) => { u: number; v: number }) {}

  newRally() {
    this.shots = 0;
    this.peakKmh = 0;
    this.lastShotKmh = 0;
    this.smoothMs = 0;
    this.prevVel = null;
    this.last = null;
    this.seen = false;
    this.hit = null;
  }

  push(s: ShuttleSample) {
    this.recent.push(s);
    while (this.recent.length && s.t - this.recent[0].t > 1) this.recent.shift();
    const { u, v } = this.toFloor(s.x, s.y);
    const last = this.last;
    const gap = last ? s.t - last.t : Infinity;

    if (!last || gap > GONE_AFTER_S) {
      // a new flight starts. The first one in a rally is the serve.
      if (!this.seen || this.shots === 0) this.count(s.t, u, v);
      this.seen = true;
      this.prevVel = null;
      this.last = { ...s, u, v };
      return;
    }
    if (gap < 0.006) return; // two samples for the same moment

    const vel = { x: (s.x - last.x) / gap, y: (s.y - last.y) / gap };
    const metres = Math.hypot((u - last.u) * COURT_W, (v - last.v) * COURT_L);
    const ms = metres / gap;
    if (ms <= MAX_SPEED_MS) {
      this.smoothMs = this.smoothMs ? 0.5 * this.smoothMs + 0.5 * ms : ms;
      this.peakKmh = Math.max(this.peakKmh, this.smoothMs * 3.6);
    }

    // A shuttle that is hardly moving (the very top of its flight) has no reliable direction: keep the last good one.
    if (Math.hypot(vel.x, vel.y) < 0.02) {
      this.last = { ...s, u, v };
      return;
    }

    const prev = this.prevVel;
    if (prev) {
      const dot = vel.x * prev.x + vel.y * prev.y;
      const norm = Math.hypot(vel.x, vel.y) * Math.hypot(prev.x, prev.y);
      if (norm > 0 && dot / norm < -0.2 && s.t - this.lastHitT >= MIN_HIT_GAP_S) {
        this.lastShotKmh = this.peakKmh;
        this.peakKmh = 0;
        this.count(s.t, last.u, last.v);
      }
    }
    this.prevVel = vel;
    this.last = { ...s, u, v };
  }

  private count(t: number, u: number, v: number) {
    this.shots += 1;
    this.lastHitT = t;
    this.hit = { t, u, v };
  }

  /** What happened so far in this rally, for deciding who won it (see rallyEnd.ts). */
  trace(): RallyTrace {
    const l = this.last;
    return { shots: this.shots, lastHit: this.hit, lastSeen: l ? { t: l.t, u: l.u, v: l.v } : null };
  }

  /** What to show now, or null if the shuttle has not been seen for a while. */
  stats(now: number): ShuttleStats | null {
    if (!this.last || now - this.last.t > GONE_AFTER_S) return null;
    const kmh = this.lastShotKmh > 0 ? this.lastShotKmh : this.peakKmh;
    return { speedKmh: Math.round(kmh), shots: this.shots };
  }

  /** The last fraction of a second of the path, oldest first, in frame fractions. */
  trail(now: number, maxAge = 0.5): { x: number; y: number }[] {
    return this.recent.filter((p) => now - p.t <= maxAge).map((p) => ({ x: p.x, y: p.y }));
  }
}
