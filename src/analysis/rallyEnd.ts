import { COURT_L, COURT_W } from './court';
import type { Side } from '../engine/types';

export interface FloorPoint { t: number; u: number; v: number }

/** What the shuttle did in a rally, as far as the estimator saw it. */
export interface RallyTrace {
  shots: number;
  /** Where and when the shuttle last changed direction (the last hit). */
  lastHit: FloorPoint | null;
  /** The last place the shuttle was seen. */
  lastSeen: FloorPoint | null;
}

export interface Verdict {
  winner: Side;
  /** 0-1. Low when the landing was close to a line or the path was short. */
  confidence: number;
  reason: string;
}

/** The shuttle must be gone this long before a rally is called finished. */
export const GONE_S = 1.6;
/** A rally with fewer shots than this is probably noise or a serve being fumbled. */
export const MIN_SHOTS = 2;
const SINGLES_SIDE_M = 0.46;
/** Floor positions of a shuttle are rough, so lines count as "close" within this distance (metres). */
const UNSURE_M = 0.6;

/** Near side (A) is v > 0.5, far side (B) is v < 0.5. */
const sideOf = (v: number): Side => (v > 0.5 ? 'A' : 'B');
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * Decides who won a rally from where the shuttle was last hit and where it was last seen.
 *
 * The player who made the last hit wins only if the shuttle crossed the net and came down inside the court. Otherwise
 * (into the net, or out) the last hitter loses. Returns null until the shuttle has been gone for GONE_S.
 */
export function judgeRally(trace: RallyTrace, now: number, singles: boolean): Verdict | null {
  const { lastHit, lastSeen } = trace;
  if (!lastHit || !lastSeen || trace.shots < MIN_SHOTS) return null;
  if (now - lastSeen.t < GONE_S) return null;

  const hitter = sideOf(lastHit.v);
  const lands = sideOf(lastSeen.v);
  const side = singles ? SINGLES_SIDE_M : 0;
  const xm = lastSeen.u * COURT_W;
  const ym = lastSeen.v * COURT_L;
  // distance outside (positive) or inside (negative) the nearest line, in metres
  const outside = Math.max(side - xm, xm - (COURT_W - side), -ym, ym - COURT_L);
  const inBounds = outside < 0;
  const nearLine = Math.abs(outside) < UNSURE_M;
  const crossed = lands !== hitter;
  const nearNet = Math.abs(lastSeen.v - 0.5) * COURT_L < UNSURE_M;

  const hitterWins = crossed && inBounds;
  let confidence = 0.8;
  if (nearLine) confidence -= 0.35;
  if (nearNet) confidence -= 0.25;
  if (trace.shots < 3) confidence -= 0.1;
  const reason = hitterWins ? 'landed in' : !crossed ? 'stayed on hitter\'s side' : 'landed out';
  return { winner: hitterWins ? hitter : other(hitter), confidence: Math.max(0.1, +confidence.toFixed(2)), reason };
}
