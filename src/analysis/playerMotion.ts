import { COURT_L, COURT_W } from './court';
import type { Track } from './players';

/** Steps smaller than this (metres) between two samples are detector jitter, not movement. */
const STEP_DEADBAND_M = 0.06;
/** The busiest player moving slower than this (metres per second) counts as "stopped". */
export const CALM_MS = 0.8;
const KEEP_S = 8;

interface Sample { t: number; at: Map<number, { u: number; v: number }> }

/**
 * How much the players are moving. Players usually stop for a couple of seconds once the shuttle has landed, and keep
 * running while a rally is still on, so this tells a finished rally from a shuttle the camera merely lost.
 * Time is in seconds on any clock, as long as it is the same one for `push` and the questions.
 */
export class PlayerMotion {
  private samples: Sample[] = [];

  push(t: number, tracks: Track[]) {
    const at = new Map<number, { u: number; v: number }>();
    for (const tr of tracks) if (!tr.lost) at.set(tr.id, { u: tr.u, v: tr.v });
    this.samples.push({ t, at });
    while (this.samples.length && t - this.samples[0].t > KEEP_S) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  /**
   * Speed of the busiest player over the last `windowS` seconds, in metres per second. Undefined when there is too little
   * data to say (no tracking, or players not seen over most of the window).
   */
  activity(now: number, windowS: number): number | undefined {
    const from = now - windowS;
    const inWindow = this.samples.filter((s) => s.t >= from && s.t <= now);
    if (inWindow.length < 3) return undefined;
    const ids = new Set<number>();
    for (const s of inWindow) for (const id of s.at.keys()) ids.add(id);
    let busiest: number | undefined;
    for (const id of ids) {
      let path = 0;
      let first = Infinity;
      let last = -Infinity;
      let prev: { u: number; v: number } | undefined;
      let n = 0;
      for (const s of inWindow) {
        const p = s.at.get(id);
        if (!p) { prev = undefined; continue; }
        n++;
        first = Math.min(first, s.t);
        last = Math.max(last, s.t);
        if (prev) {
          const d = Math.hypot((p.u - prev.u) * COURT_W, (p.v - prev.v) * COURT_L);
          if (d >= STEP_DEADBAND_M && d < 3) path += d;
        }
        prev = p;
      }
      if (n < 3 || last - first < 0.6 * windowS) continue;
      const speed = path / (last - first);
      busiest = busiest === undefined ? speed : Math.max(busiest, speed);
    }
    return busiest;
  }

  /** True when every tracked player has been nearly still over the last `windowS` seconds, false when someone is moving, undefined when unknown. */
  calm(now: number, windowS: number): boolean | undefined {
    const a = this.activity(now, Math.max(0.5, windowS));
    return a === undefined ? undefined : a < CALM_MS;
  }
}
