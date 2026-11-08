import { COURT_L, COURT_W } from './court';

/**
 * How far a shuttle flies before drag has cut its speed to a fraction 1/e of the start, along its path: terminal speed squared over
 * gravity. A feather shuttle's terminal speed is about 6.7 m/s, so about 4.6 m. This is why a smash that leaves the racket at
 * 60 m/s and a clear that leaves at 40 m/s both look slower when you divide distance by time.
 */
export const DRAG_LENGTH_M = 6.7 * 6.7 / 9.81;

/** The shot is believed only inside these limits: outside them a hit was missed or invented, or the rally had stopped. */
const MIN_SECONDS = 0.15;
const MAX_SECONDS = 3;
const MIN_METRES = 1.5;
const MAX_METRES = 20;
/** The slowest and fastest start speeds reported (m/s). The record is about 137 m/s. */
const MIN_MS = 4;
const MAX_MS = 130;

export interface Floor { u: number; v: number }

/**
 * How fast a shot left the racket, from where it was hit and where it was hit next.
 *
 * One camera cannot see how far a shuttle is from it, so the shuttle's picture position cannot give its speed. What the
 * court map does give is where the two players were standing, on the floor, and the time between the two hits is known. The
 * shuttle flew about the distance between them (this is a straight line, so a lob really flew further: the answer is a little low
 * for high shots). Drag slows the shuttle along the way, so with the start speed v0 the distance covered in time T is
 *
 *     distance = L * ln(1 + v0 * T / L),   L = DRAG_LENGTH_M
 *
 * which gives v0 = (L / T) * (exp(distance / L) - 1). Returns null when the numbers are not believable.
 */
export function shotSpeed(from: Floor, to: Floor, seconds: number): { kmh: number; metres: number } | null {
  if (!(seconds >= MIN_SECONDS && seconds <= MAX_SECONDS)) return null;
  const metres = Math.hypot((to.u - from.u) * COURT_W, (to.v - from.v) * COURT_L);
  if (!(metres >= MIN_METRES && metres <= MAX_METRES)) return null;
  const ms = (DRAG_LENGTH_M / seconds) * (Math.exp(metres / DRAG_LENGTH_M) - 1);
  if (!(ms >= MIN_MS && ms <= MAX_MS)) return null;
  return { kmh: ms * 3.6, metres };
}
