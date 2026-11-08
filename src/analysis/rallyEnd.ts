import { COURT_L, COURT_W } from './court';
import type { Court, Side } from '../engine/types';

/** A place on the court floor. `air` means the shuttle might have been above the floor there, so u and v mean nothing. */
export interface FloorPoint { t: number; u: number; v: number; air?: boolean }

/** What the shuttle did in a rally, as far as the estimator saw it. */
export interface RallyTrace {
  shots: number;
  /** Where and when the shuttle last changed direction (the last hit). */
  lastHit: FloorPoint | null;
  /** The last place the shuttle was seen. */
  lastSeen: FloorPoint | null;
  /** Where the shuttle was first seen in this rally, which should be the serve. */
  firstSeen?: FloorPoint | null;
  /** The last sighting that was on the floor, if any. */
  lastFloor?: FloorPoint | null;
  /** Where in the picture (fractions of the frame) the shuttle was when it was first seen, which should be the serve. */
  firstImage?: { t: number; x: number; y: number } | null;
  /** Where in the picture (fractions of the frame) the shuttle was when it was last hit. */
  hitImage?: { t: number; x: number; y: number } | null;
  /** The shuttle was moving down the picture when it was last seen, so it probably came down rather than being hidden. */
  descending?: boolean;
  /** Times the shuttle changed direction with no player near it (the ceiling, a wall, the net tape, or a tracking glitch): not counted as hits. */
  strays?: number;
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
/** A floor sighting this close (seconds) before the shuttle was lost can stand in for where it came down. */
const INDIRECT_S = 0.8;
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
export function judgeRally(trace: RallyTrace, now: number, singles: boolean, calm?: boolean, hitterSide?: Side): Verdict | null {
  const { lastSeen } = trace;
  if (!lastSeen || trace.shots < MIN_SHOTS) return null;
  if (!isRallyOver(trace, now, singles, calm)) return null;

  // Who hit it last: the side of the nearest player at that moment when the caller knows it, otherwise the side of the floor
  // position of the hit, which is only meaningful when the shuttle was low enough to be on the floor map.
  const hitter = hitterSide ?? (trace.lastHit && !trace.lastHit.air ? sideOf(trace.lastHit.v) : undefined);
  if (!hitter) return null;
  // Where it came down: the last sighting if that was on the floor, else the last floor sighting just before it. A shuttle that
  // vanished high in the air has not come down anywhere we saw, and no point is called.
  let landing: FloorPoint | undefined = lastSeen.air ? undefined : lastSeen;
  const indirect = !landing;
  if (!landing && trace.lastFloor && lastSeen.t - trace.lastFloor.t <= INDIRECT_S) landing = trace.lastFloor;
  if (!landing) return null;

  const lands = sideOf(landing.v);
  const { inBounds, outside } = landingCall(landing, singles);
  const nearLine = Math.abs(outside) < UNSURE_M;
  const crossed = lands !== hitter;
  const nearNet = Math.abs(landing.v - 0.5) * COURT_L < UNSURE_M;

  const hitterWins = crossed && inBounds;
  let confidence = 0.8;
  if (nearLine) confidence -= 0.35;
  if (nearNet) confidence -= 0.25;
  if (trace.shots < 3) confidence -= 0.1;
  if (indirect) confidence -= 0.2;
  if (!hitterSide) confidence -= 0.1;
  if (trace.strays) confidence -= 0.2; // the shuttle changed direction away from the players: it may have touched something
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

/**
 * Whether a floor position is inside the court, and how far outside (positive) or inside (negative) the nearest line it is, in metres.
 * The lines are part of the court (a shuttle that lands on a line is in), and the corners the user marks are the outer edges of the
 * lines, so a position exactly on the boundary is in.
 */
export function landingCall(p: { u: number; v: number }, singles: boolean): { inBounds: boolean; outside: number } {
  const side = singles ? SINGLES_SIDE_M : 0;
  const xm = p.u * COURT_W;
  const ym = p.v * COURT_L;
  const outside = Math.max(side - xm, xm - (COURT_W - side), -ym, ym - COURT_L);
  return { inBounds: outside <= 0, outside };
}

/** From the net to the short service line (metres), and the doubles long service line's distance inside the back line. */
const SHORT_SERVICE_M = 1.98;
const DOUBLES_LONG_SERVICE_M = 0.76;

/**
 * Whether a serve that came down at this floor position is good, and how far outside the service court it is (metres, negative inside).
 * The service court is the one diagonally across the net from the server: from the short service line (1.98 m from the net) to the
 * back line in singles, or to the doubles long service line (0.76 m in from the back line) in doubles, and from the centre line to the
 * side line (the inner singles side line in singles, the outer one in doubles). A server in the right court serves into the receiver's
 * right court, which is on the opposite half of the picture.
 */
export function serveCall(p: { u: number; v: number }, server: { side: Side; court: Court }, singles: boolean): { inCourt: boolean; outside: number } {
  const half = COURT_W / 2;
  const serverRightOfPicture = server.side === 'A' ? server.court === 'right' : server.court === 'left'; // near server's right is the picture's right, far server's is its left
  const xm = p.u * COURT_W;
  const side = singles ? SINGLES_SIDE_M : 0;
  // the receiver's court is on the other half of the picture to the server
  const [lo, hi] = serverRightOfPicture ? [side, half] : [half, COURT_W - side];
  const outsideAcross = Math.max(lo - xm, xm - hi);
  // distance from the net on the receiver's half (negative when it came down on the server's own half)
  const fromNet = (server.side === 'A' ? 0.5 - p.v : p.v - 0.5) * COURT_L;
  const back = COURT_L / 2 - (singles ? 0 : DOUBLES_LONG_SERVICE_M);
  const outsideAlong = Math.max(SHORT_SERVICE_M - fromNet, fromNet - back);
  const outside = Math.max(outsideAcross, outsideAlong);
  return { inCourt: outside <= 0, outside };
}

/**
 * Decides a rally in which only the serve was seen: the receiver did not hit it back. If it came down in the right service court
 * the server wins (an ace, or a return that was missed); otherwise it is a service fault (into the net, short, long, wide, or into the
 * wrong court) and the receiver wins. Returns null until the rally is over, or when it came down nowhere we saw.
 * Less sure than a longer rally, because the camera may simply have missed the return.
 */
export function judgeServe(trace: RallyTrace, now: number, singles: boolean, serve: { side: Side; court: Court }, calm?: boolean): Verdict | null {
  const { lastSeen } = trace;
  if (!lastSeen || trace.shots !== 1) return null;
  if (!isRallyOver(trace, now, singles, calm)) return null;
  // where it came down: the last sighting if that was on the floor, else the last floor sighting just before it
  let landing: FloorPoint | undefined = lastSeen.air ? undefined : lastSeen;
  const indirect = !landing;
  if (!landing && trace.lastFloor && lastSeen.t - trace.lastFloor.t <= INDIRECT_S) landing = trace.lastFloor;
  if (!landing) return null;
  const { inCourt, outside } = serveCall(landing, serve, singles);
  const nearLine = Math.abs(outside) < UNSURE_M;
  let confidence = 0.65;
  if (nearLine) confidence -= 0.3;
  if (indirect) confidence -= 0.15;
  if (trace.strays) confidence -= 0.2;
  if (calm === true) confidence += 0.1;
  if (calm === false) confidence -= 0.2;
  const receiver: Side = serve.side === 'A' ? 'B' : 'A';
  return { winner: inCourt ? serve.side : receiver, confidence: Math.max(0.1, +confidence.toFixed(2)), reason: inCourt ? 'serve landed in, not returned' : 'service fault' };
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
  // a shuttle last seen in the air has not come down anywhere we can see, so it only gets the long wait
  return gone >= LANDED_S && !seen.air && trace.descending === true && trace.shots >= MIN_SHOTS && clearLanding(seen, singles);
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
  if (first.air) return null; // a serve is hit above the floor: its floor position says nothing, so the start cannot be checked
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
