import { denormalizeCorners, normalizeCorners, type Corners } from './court';
import { replay } from '../engine/scoring';
import type { MatchConfig, MatchState, Rally } from '../engine/types';
import { screenToFrame } from './preprocess';
import type { ShuttleStats } from './shuttle';
import type { FrameGeometry } from './tracker';

/** One moment of the live overlay, saved while recording so the review can draw it over the video again. */
export interface OverlaySnapshot {
  /** Milliseconds since recording started. */
  t: number;
  tracks: { id: number; u: number; v: number; lost?: number }[];
  /** Track id -> player index, so a name tag swapped by the user replays the same way. */
  assign: number[];
  /** Metres covered per player so far, or null when players are not being tracked. */
  dist: (number | null)[];
  shuttle?: ShuttleStats;
}

export interface OverlayData {
  version: 1;
  /** Width / height of the recorded video. */
  frameAspect: number;
  /** Court corners as fractions of the recorded video frame. */
  corners: Corners | null;
  snapshots: OverlaySnapshot[];
}

/** A snapshot older than this is not shown (the tracker was off or lost everyone). */
export const SNAPSHOT_MAX_AGE_MS = 1500;

/** The newest snapshot at or before `tMs`, or undefined if there is none recent enough. */
export function snapshotAt(snaps: OverlaySnapshot[], tMs: number): OverlaySnapshot | undefined {
  let lo = 0;
  let hi = snaps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].t <= tMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0 || tMs - snaps[found].t > SNAPSHOT_MAX_AGE_MS) return undefined;
  return snaps[found];
}

/** The game as it stood at `tMs`: only the rallies that had finished by then count. */
export function stateAt(config: MatchConfig, rallies: Rally[], tMs: number): MatchState {
  const done: Rally[] = [];
  for (const r of rallies) {
    if (r.endMs != null && r.endMs > tMs) break;
    done.push(r);
  }
  return replay(config, done);
}

/** Screen-pixel court corners to fractions of the camera frame, using the same crop as the preview. */
export function cornersToFrame(c: Corners, g: FrameGeometry): Corners {
  const f = (p: { x: number; y: number }) => screenToFrame(p, g);
  return { farLeft: f(c.farLeft), farRight: f(c.farRight), nearRight: f(c.nearRight), nearLeft: f(c.nearLeft) };
}

/** Frame fractions back to pixels inside a box of the given size (for example the video player). */
export const cornersInBox = (c: Corners, w: number, h: number): Corners => denormalizeCorners(c, w, h);
export { normalizeCorners };
