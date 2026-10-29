import { COURT_L, COURT_W, type CourtMap, type Pt } from './court';
import type { Detection, PersonDetector } from './detector';
import type { PlayerTracker, Track } from './players';

export interface FrameGeometry {
  /** Camera frame width / height (landscape). */
  frameAspect: number;
  screenW: number;
  screenH: number;
}

/**
 * Where a detection's feet are on the screen. The preview fills the screen and crops the camera
 * frame to do it ("cover"), so detection coordinates have to be mapped the same way as the preview.
 */
export function footToScreen(d: Detection, g: FrameGeometry): Pt {
  const scale = Math.max(g.screenW / g.frameAspect, g.screenH); // frame is frameAspect x 1 units
  const ox = (g.screenW - g.frameAspect * scale) / 2;
  const oy = (g.screenH - scale) / 2;
  return { x: (d.x + d.w / 2) * g.frameAspect * scale + ox, y: (d.y + d.h) * scale + oy };
}

export interface TrackerOptions {
  nNear: number;
  nFar: number;
  /** Ignore detections below this confidence. */
  minScore?: number;
  /** How far, in metres, a player may move between two frames and still be the same person. */
  gateMetres?: number;
  /** Frames a player may go undetected before their track is dropped. */
  maxLostFrames?: number;
  /** 0..1. Higher follows the detector more closely, lower is smoother. */
  smoothing?: number;
  /** How far outside the court lines, as a fraction of its size, a person still counts as a player. */
  margin?: number;
}

interface Slot { id: number; u: number; v: number; vu: number; vv: number; lost: number }
interface Pos { u: number; v: number; score: number }

const dist = (a: { u: number; v: number }, b: { u: number; v: number }) =>
  Math.hypot((a.u - b.u) * COURT_W, (a.v - b.v) * COURT_L);

/**
 * Picks the pairing of tracks to detections with the most pairs, then the smallest total distance.
 * There are at most 2 players per side, so trying every pairing is cheap.
 */
function assign(cost: number[][], gate: number[]): Map<number, number> {
  const nT = cost.length;
  const nD = nT ? cost[0].length : 0;
  let best: { pairs: [number, number][]; total: number } = { pairs: [], total: Infinity };
  const walk = (t: number, used: Set<number>, pairs: [number, number][], total: number) => {
    if (t === nT) {
      if (pairs.length > best.pairs.length || (pairs.length === best.pairs.length && total < best.total)) best = { pairs: [...pairs], total };
      return;
    }
    walk(t + 1, used, pairs, total); // leave this track unmatched
    for (let d = 0; d < nD; d++) {
      if (used.has(d) || cost[t][d] > gate[t]) continue;
      used.add(d);
      pairs.push([t, d]);
      walk(t + 1, used, pairs, total + cost[t][d]);
      pairs.pop();
      used.delete(d);
    }
  };
  walk(0, new Set(), [], 0);
  return new Map(best.pairs);
}

/**
 * Turns per-frame person detections into stable player tracks on the court.
 * Track ids are fixed slots: near-side players take ids 0..nNear-1 and far-side players take
 * nNear..nNear+nFar-1. A new player on a side gets the lowest free id, in left-to-right order.
 */
export class PlayerTrackerCore {
  private slots: (Slot | null)[];
  private o: Required<TrackerOptions>;

  constructor(options: TrackerOptions) {
    this.o = { minScore: 0.4, gateMetres: 2, maxLostFrames: 30, smoothing: 0.5, margin: 0.25, ...options };
    this.slots = new Array(options.nNear + options.nFar).fill(null);
  }

  reset() {
    this.slots.fill(null);
  }

  update(detections: Detection[], map: CourtMap, g: FrameGeometry): Track[] {
    const m = this.o.margin;
    const pts: Pos[] = [];
    for (const d of detections) {
      if (d.score < this.o.minScore) continue;
      const c = map.toCourt(footToScreen(d, g));
      if (c.u < -m || c.u > 1 + m || c.v < -m || c.v > 1 + m) continue; // spectators, people on other courts
      pts.push({ u: c.u, v: c.v, score: d.score });
    }
    this.side(0, this.o.nNear, pts.filter((p) => p.v >= 0.5));
    this.side(this.o.nNear, this.o.nNear + this.o.nFar, pts.filter((p) => p.v < 0.5));

    return this.slots.filter((s): s is Slot => s !== null).map((s) => ({ id: s.id, u: s.u, v: s.v, lost: s.lost }));
  }

  private side(from: number, to: number, pts: Pos[]) {
    const live = this.slots.slice(from, to).filter((s): s is Slot => s !== null);
    const cost = live.map((s) => pts.map((p) => dist({ u: s.u + s.vu, v: s.v + s.vv }, p)));
    const gate = live.map((s) => this.o.gateMetres + 0.2 * s.lost);
    const matched = assign(cost, gate);

    const taken = new Set<number>();
    live.forEach((s, i) => {
      const di = matched.get(i);
      if (di === undefined) {
        s.lost++; // coast on the last velocity, fading out
        s.u += s.vu * 0.8;
        s.v += s.vv * 0.8;
        s.vu *= 0.8;
        s.vv *= 0.8;
        if (s.lost > this.o.maxLostFrames) this.slots[s.id] = null;
        return;
      }
      taken.add(di);
      const a = this.o.smoothing;
      const nu = s.u + a * (pts[di].u - s.u);
      const nv = s.v + a * (pts[di].v - s.v);
      s.vu = 0.5 * s.vu + 0.5 * (nu - s.u);
      s.vv = 0.5 * s.vv + 0.5 * (nv - s.v);
      s.u = nu;
      s.v = nv;
      s.lost = 0;
    });

    // New players: strongest unmatched detections first, only as many as there are free ids.
    const free: number[] = [];
    for (let id = from; id < to; id++) if (this.slots[id] === null) free.push(id);
    const fresh = pts.map((p, i) => ({ p, i })).filter(({ i }) => !taken.has(i)).sort((x, y) => y.p.score - x.p.score).slice(0, free.length);
    fresh.sort((x, y) => x.p.u - y.p.u); // left to right gets the lower id
    fresh.forEach(({ p }, k) => {
      const id = free[k];
      this.slots[id] = { id, u: p.u, v: p.v, vu: 0, vv: 0, lost: 0 };
    });
  }
}

/** Connects a person detector to the tracking core and reports tracks to the app. */
export class DetectorPlayerTracker implements PlayerTracker {
  private core: PlayerTrackerCore;

  constructor(
    private detector: PersonDetector,
    private getMap: () => CourtMap,
    private getGeometry: () => FrameGeometry,
    options: TrackerOptions,
  ) {
    this.core = new PlayerTrackerCore(options);
  }

  start(onTracks: (tracks: Track[]) => void) {
    this.core.reset();
    this.detector.start((dets) => onTracks(this.core.update(dets, this.getMap(), this.getGeometry())));
  }

  stop() {
    this.detector.stop();
  }
}
