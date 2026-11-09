import type { Corners } from './court';
import { frameToScreen } from './preprocess';
import type { FrameGeometry } from './tracker';

/**
 * The court after the camera has moved: the corners were set on the screen, and if the picture has moved by (dx, dy) (fractions of the
 * camera frame, see cameraShift.ts) the court has moved with it, by the same distance on the screen. Right for a small pan or tilt,
 * where the picture slides without changing shape.
 */
export function followCorners(c: Corners, shift: { dx: number; dy: number }, g: FrameGeometry): Corners {
  const from = frameToScreen({ x: 0.5, y: 0.5 }, g);
  const to = frameToScreen({ x: 0.5 + shift.dx, y: 0.5 + shift.dy }, g);
  const dx = to.x - from.x, dy = to.y - from.y;
  const m = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return { farLeft: m(c.farLeft), farRight: m(c.farRight), nearRight: m(c.nearRight), nearLeft: m(c.nearLeft) };
}

/** Below this (as a share of the frame) the camera is where it was; above MAX_FOLLOW it has moved too far to follow and the court must be set again. */
export const STILL_BELOW = 0.006;
export const MAX_FOLLOW = 0.08;

export type CourtCall =
  | { kind: 'in-place' }                                          // the camera is where it was
  | { kind: 'follow'; dx: number; dy: number }                    // moved a little, steadily: move the court with it
  | { kind: 'lost' }                                              // moved too far, or the view is too different to tell: warn
  | { kind: 'wait' };                                             // not sure yet

/**
 * What to do with a reading of how far the camera has moved since the court was locked. A court is only moved with the camera when
 * the picture agrees well with the reference and two readings in a row say the same thing, so a person walking past or one odd
 * picture cannot shift it.
 */
export function judgeShift(now: { dx: number; dy: number; quality: number }, before: { dx: number; dy: number } | null): CourtCall {
  if (now.quality < 0.5) return { kind: 'lost' };
  const mag = Math.hypot(now.dx, now.dy);
  if (mag < STILL_BELOW) return { kind: 'in-place' };
  if (mag > MAX_FOLLOW) return { kind: 'lost' };
  if (now.quality >= 0.8 && before && Math.hypot(now.dx - before.dx, now.dy - before.dy) < 0.004) return { kind: 'follow', dx: now.dx, dy: now.dy };
  return { kind: 'wait' };
}
