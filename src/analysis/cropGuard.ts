import type { Roi } from './preprocess';

/** How close to an edge of the crop (as a share of its size) a sighting must be for a vanishing shuttle to count as "left the crop". */
const EDGE = 0.12;
/** The shuttle is missing this long (seconds) after being last seen near an edge of the crop before the whole frame is tried. */
const LOST_S = 0.12;
/** The whole frame is kept at least this long, then the crop returns once the shuttle is seen inside it, or has not been seen for a second. */
const HOLD_S = 2;
const QUIET_S = 1;

interface Seen { t: number; x: number; y: number }

/**
 * Looking only at the court makes the shuttle bigger to the model, but a shuttle hit out of the crop (wide, far behind a baseline,
 * or high above the court) cannot be seen. This decides when to look at the whole frame instead: when the shuttle was last seen
 * near an edge of the crop that is not also an edge of the camera frame, and then vanished. The crop comes back once the shuttle
 * has been seen inside it again, or nothing has been seen for a while.
 *
 * Positions are fractions of the whole camera frame, as the model reports them.
 */
export class CropGuard {
  private full = false;
  private since = 0;
  private last: Seen | null = null;

  constructor(private crop: Roi | null = null) {}

  /** A new crop (the court was moved) or none. Starts again. */
  setCrop(crop: Roi | null) {
    this.crop = crop;
    this.full = false;
    this.last = null;
  }

  /** True while the whole frame is wanted. */
  get wantsFull(): boolean { return this.full; }

  private inside(p: Seen): boolean {
    const c = this.crop!;
    return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
  }

  /** Near an edge of the crop that has more picture beyond it (a crop edge on the frame's own edge cannot lose anything). */
  private nearOpenEdge(p: Seen): boolean {
    const c = this.crop!;
    const mx = EDGE * c.w;
    const my = EDGE * c.h;
    return (c.x > 0.001 && p.x < c.x + mx) || (c.x + c.w < 0.999 && p.x > c.x + c.w - mx)
        || (c.y > 0.001 && p.y < c.y + my) || (c.y + c.h < 0.999 && p.y > c.y + c.h - my);
  }

  /** Feed the model's frames (time in seconds, position or nothing). Returns whether the whole frame is wanted now. */
  push(frames: { t: number; x?: number; y?: number }[]): boolean {
    if (!this.crop) return false;
    for (const f of frames) {
      const seen = f.x !== undefined && f.y !== undefined;
      if (seen) this.last = { t: f.t, x: f.x!, y: f.y! };
      const last = this.last;
      if (!this.full) {
        if (last && !seen && f.t - last.t >= LOST_S && f.t - last.t < 1 && this.nearOpenEdge(last)) {
          this.full = true;
          this.since = f.t;
        }
      } else if (f.t - this.since >= HOLD_S) {
        if ((seen && this.inside(this.last!) && !this.nearOpenEdge(this.last!)) || !last || f.t - last.t >= QUIET_S) {
          this.full = false;
          this.last = null;
        }
      }
    }
    return this.full;
  }
}
