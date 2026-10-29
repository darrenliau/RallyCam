import { COURT_L, COURT_W } from './court';
import type { Court, Side } from '../engine/types';

export interface FloorPoint { t: number; u: number; v: number }

/** What the shuttle did in a rally, as far as the estimator saw it. */
export interface RallyTrace {
  shots: number;
  /** Where and when the shuttle last changed direction (the last hit). */
  lastHit: FloorPoint | null;
  /** The last place the shuttle was seen. */
  lastSeen: FloorPoint | null;
  /** Where the shuttle was first seen in this rally, which should be the serve. */
  firstSeen?: FloorPoint | null;
}

/** Who should be serving, and from where, according to the score. */
export interface ServeExpectation {
  side: Side;
  court: Court;
  /** Where the server is standing now, if a player is being tracked. */
  server?: { u: number; v: number };
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

/** How far from the server (metres) the shuttle may first appear. Floor positions of a shuttle in the air are rough. */
const SERVER_REACH_M = 3.5;
/** Slack on the left/right halves, as a fraction of the court width. */
const HALF_SLACK = 0.12;

/** True when the shuttle has been gone long enough that the rally is over (or was never one). */
export function isRallyOver(trace: RallyTrace, now: number): boolean {
  return !!trace.lastSeen && now - trace.lastSeen.t >= GONE_S;
}

/**
 * Checks that the rally began like a serve. A shuttle picked up and tossed back, a practice hit, or a stray shuttle on the
 * next court all produce movement that is not a rally, and counting them gives phantom points.
 * Returns why it does not look like a serve, or null if it does.
 */
export function serveProblem(trace: RallyTrace, serve: ServeExpectation): string | null {
  const first = trace.firstSeen;
  if (!first) return 'no start seen';
  if (sideOf(first.v) !== serve.side) return 'started on the wrong side';
  // A near-side server (A) faces away from the camera, so their right is the camera's right. For the far side it is the other way round.
  const right = serve.side === 'A' ? first.u > 0.5 - HALF_SLACK : first.u < 0.5 + HALF_SLACK;
  const left = serve.side === 'A' ? first.u < 0.5 + HALF_SLACK : first.u > 0.5 - HALF_SLACK;
  if (serve.court === 'right' ? !right : !left) return 'started from the wrong court';
  if (serve.server) {
    const d = Math.hypot((first.u - serve.server.u) * COURT_W, (first.v - serve.server.v) * COURT_L);
    if (d > SERVER_REACH_M) return 'started far from the server';
  }
  return null;
}
