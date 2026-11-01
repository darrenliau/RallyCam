import { looksLikeFlight, type PathPoint } from './shuttlePath';
import type { ShuttleSample } from './shuttleStats';

/** One frame of what the on-phone shuttle model saw: where, as fractions of the camera frame, or nothing. */
export interface ModelFrame { t: number; x?: number; y?: number }

const W = 1920;
const H = 1080;
/** Longest the model may lose the shuttle (seconds) before a new sighting starts a new flight. */
const MAX_GAP_S = 0.3;
/** No shuttle moves further than this between two sightings: 400 pixels a frame at 60 frames a second. */
const MAX_PX_PER_S = 24000;
const SLACK_PX = 20;
/** A new flight is only believed once it has this many sightings that move and fit a smooth curve (a curve needs 4 points to be judged)... */
const START_POINTS = 4;
/** ...and the sightings that start it are at most this far apart in time (4 frames at 60 per second), so scattered false sightings never line up. */
const START_MAX_GAP_S = 0.07;
/** ...and has moved at least this far (pixels), so a speck that sits still is not a flight. */
const START_MOVE_PX = 12;
/** The last STILL_POINTS sightings all within STILL_PX of each other mean something is sitting there, not flying. */
const STILL_POINTS = 6;
const STILL_PX = 6;
const KEEP = 10;

/**
 * The model reports a position for each frame it sees the shuttle in, and now and then it is wrong: a white spot on the wall,
 * a shoe, a light. A real shuttle makes a smooth path from one frame to the next, so this keeps only sightings that continue a
 * path, and drops lone sightings, jumps, and anything that sits still.
 *
 * `push` takes the model's frames (usually 8 at a time) and returns the samples to give the shuttle estimator, in the same
 * fractions of the frame. The first sightings of a new flight are held back until it has proved itself, then handed over together.
 */
export class ModelTrackFilter {
  private chain: PathPoint[] = [];
  private believed = false;

  reset() {
    this.chain = [];
    this.believed = false;
  }

  push(frames: ModelFrame[]): ShuttleSample[] {
    const out: ShuttleSample[] = [];
    const emit = (p: PathPoint) => out.push({ t: p.t, x: p.x / W, y: p.y / H });
    for (const f of frames) {
      const last = this.chain[this.chain.length - 1];
      if (f.x === undefined || f.y === undefined) {
        if (last && f.t - last.t > MAX_GAP_S) this.reset();
        continue;
      }
      const p: PathPoint = { t: f.t, x: f.x * W, y: f.y * H };
      if (!last || p.t - last.t > MAX_GAP_S || p.t <= last.t) {
        this.chain = [p];
        this.believed = false;
        continue;
      }
      const jump = Math.hypot(p.x - last.x, p.y - last.y);
      if (jump > MAX_PX_PER_S * (p.t - last.t) + SLACK_PX) {
        this.chain = [p];
        this.believed = false;
        continue;
      }
      // while a flight is not yet believed, the sightings must follow each other closely
      if (!this.believed && p.t - last.t > START_MAX_GAP_S) {
        this.chain = [p];
        continue;
      }
      this.chain.push(p);
      if (this.chain.length > KEEP) this.chain.shift();

      const tail = this.chain.slice(-STILL_POINTS);
      if (tail.length === STILL_POINTS && tail.every((q) => Math.hypot(q.x - tail[0].x, q.y - tail[0].y) <= STILL_PX)) continue;

      if (!this.believed) {
        const first = this.chain[0];
        const moved = Math.hypot(p.x - first.x, p.y - first.y);
        if (this.chain.length >= START_POINTS && moved >= START_MOVE_PX && looksLikeFlight(this.chain)) {
          this.believed = true;
          this.chain.forEach(emit);
        }
      } else if (looksLikeFlight(this.chain)) {
        emit(p);
      } else {
        this.chain = [p];
        this.believed = false;
      }
    }
    return out;
  }
}
