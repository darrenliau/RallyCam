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
  /** The shuttle was moving down the picture when it was last seen, so it probably came down rather than being hidden. */
  descending?: boolean;
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
/** After a clear landing (shuttle lost while going down, well away from the lines and the net) the rally is called this soon. */
export const LANDED_S = 0.6;
/** If the players are still running, the shuttle was probably just lost by the camera: wait up to this long before giving up. */
export const GONE_MAX_S = 4;
/** After a point is called, a shuttle seen again this soon, near where it came down, means the rally was cut short. */
export const CONTINUE_S = 2.5;
/** ...and within this distance of the landing (metres on the floor map). */
export const CONTINUE_M = 4;
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
export function judgeRally(trace: RallyTrace, now: number, singles: boolean, calm?: boolean): Verdict | null {
  const { lastHit, lastSeen } = trace;
  if (!lastHit || !lastSeen || trace.shots < MIN_SHOTS) return null;
  if (!isRallyOver(trace, now, singles, calm)) return null;

  const hitter = sideOf(lastHit.v);
  const lands = sideOf(lastSeen.v);
  const { inBounds, outside } = landingCall(lastSeen, singles);
  const nearLine = Math.abs(outside) < UNSURE_M;
  const crossed = lands !== hitter;
  const nearNet = Math.abs(lastSeen.v - 0.5) * COURT_L < UNSURE_M;

  const hitterWins = crossed && inBounds;
  let confidence = 0.8;
  if (nearLine) confidence -= 0.35;
  if (nearNet) confidence -= 0.25;
  if (trace.shots < 3) confidence -= 0.1;
  // Players stopping after the shuttle came down is what a finished rally looks like
  if (calm === true) confidence += 0.1;
  if (calm === false) confidence -= 0.2;
  const reason = hitterWins ? 'landed in' : !crossed ? 'stayed on hitter\'s side' : 'landed out';
  return { winner: hitterWins ? hitter : other(hitter), confidence: Math.max(0.1, +confidence.toFixed(2)), reason };
}

/** How far from the server (metres) the shuttle may first appear. Floor positions of a shuttle in the air are rough. */
const SERVER_REACH_M = 3.5;
/** Slack on the left/right halves, as a fraction of the court width. */
const HALF_SLACK = 0.12;

/** Whether a floor position is inside the court, and how far outside (positive) or inside (negative) the nearest line it is, in metres. */
export function landingCall(p: { u: number; v: number }, singles: boolean): { inBounds: boolean; outside: number } {
  const side = singles ? SINGLES_SIDE_M : 0;
  const xm = p.u * COURT_W;
  const ym = p.v * COURT_L;
  const outside = Math.max(side - xm, xm - (COURT_W - side), -ym, ym - COURT_L);
  return { inBounds: outside < 0, outside };
}

/** A landing position that is not close to a line or to the net, so the in or out call can be trusted. */
function clearLanding(p: { u: number; v: number }, singles: boolean): boolean {
  const { outside } = landingCall(p, singles);
  return Math.abs(outside) >= UNSURE_M && Math.abs(p.v - 0.5) * COURT_L >= UNSURE_M;
}

/**
 * True when the rally is over (or was never one). That is when the shuttle has been gone for GONE_S, or sooner, after
 * LANDED_S, when it was lost coming down at a spot that is clearly in or clearly out. A shuttle lost any other way
 * (going up, hidden behind a player) could still come back, so it gets the longer wait.
 */
export function isRallyOver(trace: RallyTrace, now: number, singles = false, calm?: boolean): boolean {
  const seen = trace.lastSeen;
  if (!seen) return false;
  const gone = now - seen.t;
  if (gone >= GONE_MAX_S) return true;
  // Players keep running while a rally is on and stop once the shuttle has landed. Still moving means wait.
  if (calm === false) return false;
  if (gone >= GONE_S) return true;
  return gone >= LANDED_S && trace.descending === true && trace.shots >= MIN_SHOTS && clearLanding(seen, singles);
}

/**
 * True when the shuttle shows up again soon after a point was called, near where it was last seen, while the players
 * are still moving: the rally was not over, the camera had lost the shuttle for a moment.
 * `sinceCallS` is the time since the point was called, `appearedAt` where the shuttle reappeared, `landing` where it was last seen.
 */
export function isContinuation(landing: { u: number; v: number }, appearedAt: { u: number; v: number }, sinceCallS: number, calm?: boolean): boolean {
  if (sinceCallS > CONTINUE_S || calm === true) return false;
  const d = Math.hypot((landing.u - appearedAt.u) * COURT_W, (landing.v - appearedAt.v) * COURT_L);
  return d <= CONTINUE_M;
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
