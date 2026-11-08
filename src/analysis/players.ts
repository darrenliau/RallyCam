import { COURT_L, COURT_W } from './court';

/** One person the tracker follows. Position is in court coordinates (see court.ts). */
export interface Track {
  id: number;
  u: number;
  v: number;
  /** Frames since the player was last detected. 0 or missing means seen in the latest frame; above 0 the position is a guess. */
  lost?: number;
}

/**
 * Phase 2 will implement this with an on-device person detector. Track ids are stable per person
 * while they are followed. Until then only SimulatedTracker (debug builds) produces tracks.
 */
export interface PlayerTracker {
  start(onTracks: (tracks: Track[]) => void): void;
  stop(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A player only counts as having moved once they are this far (metres) from where they were last counted: smaller steps are detector jitter. */
const STEP_M = 0.5;
/** A jump bigger than this between two looks is a tracker mix-up (ids swapped, a new person), not running. */
const JUMP_M = 3;

/**
 * Adds up how far each player has moved, in metres on the court floor.
 * Positions wobble by several centimetres from one look to the next even when a player stands still, so adding up every step
 * would make a player standing still cover tens of metres a minute. Instead each track keeps an anchor, the place it was last
 * counted at, and only when the player is STEP_M or more from it is that distance added and the anchor moved there.
 */
export class DistanceMeter {
  private anchor = new Map<number, { u: number; v: number }>();
  private total = new Map<number, number>();

  /** `owner` maps a track id to the player it is currently tagged as. */
  update(tracks: Track[], owner: (trackId: number) => number): void {
    for (const t of tracks) {
      if ((t.lost ?? 0) > 0) continue; // the position is a guess while the player is not seen
      const a = this.anchor.get(t.id);
      if (!a) { this.anchor.set(t.id, { u: t.u, v: t.v }); continue; }
      const d = Math.hypot((t.u - a.u) * COURT_W, (t.v - a.v) * COURT_L);
      if (d > JUMP_M) { this.anchor.set(t.id, { u: t.u, v: t.v }); continue; } // a mix-up: start counting from here
      if (d < STEP_M) continue;
      this.anchor.set(t.id, { u: t.u, v: t.v });
      const p = owner(t.id);
      this.total.set(p, (this.total.get(p) ?? 0) + d);
    }
  }

  metres(player: number): number {
    return this.total.get(player) ?? 0;
  }
}

/** Wandering fake players for trying the overlay without a real tracker. Debug builds only. */
export class SimulatedTracker implements PlayerTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pos: Track[];

  constructor(private nNear: number, private nFar: number) {
    const near = nNear === 1 ? [[0.5, 0.86]] : [[0.3, 0.88], [0.7, 0.64]];
    const far = nFar === 1 ? [[0.5, 0.16]] : [[0.32, 0.16], [0.7, 0.4]];
    this.pos = [...near, ...far].map(([u, v], id) => ({ id, u, v }));
  }

  start(onTracks: (tracks: Track[]) => void) {
    this.stop();
    this.timer = setInterval(() => {
      this.pos = this.pos.map((p) => {
        const far = p.id >= this.nNear;
        return {
          id: p.id,
          u: clamp(p.u + (Math.random() - 0.5) * 0.08, 0.14, 0.86),
          v: clamp(p.v + (Math.random() - 0.5) * 0.06, far ? 0.1 : 0.58, far ? 0.42 : 0.9),
        };
      });
      onTracks(this.pos);
    }, 200);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
