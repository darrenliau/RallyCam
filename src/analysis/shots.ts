import { COURT_L, COURT_W } from './court';
import type { HitHeight } from './pose';
import { shotSpeed, type Floor } from './shotSpeed';

/**
 * The shot families the app names. They are the ones one phone camera can tell apart: by where the shot was hit from, how high the hand was
 * (body pose), where the shuttle came down, how long it took and how fast it was. Variants that differ only by grip, racket face or spin (slice,
 * cut, tumble, reverse slice and so on) cannot be seen from one camera and belong to the family they are nearest to (see docs/shot-types.md).
 */
export type ShotType = 'SERVE' | 'SMASH' | 'KILL' | 'CLEAR' | 'DROP' | 'NET SHOT' | 'LIFT' | 'FLICK' | 'PUSH' | 'DRIVE' | 'BLOCK';

/** What is known about one shot, from the hit that sent the shuttle to where it was met next (or came down). */
export interface ShotInput {
  /** 1 is the serve. */
  number: number;
  /** Where the hitter stood, and where the shuttle went (the next hitter's spot, or where it came down). */
  from: Floor | null;
  to: Floor | null;
  /** Seconds from this hit to the next one, when there was a next one. */
  seconds: number | null;
  /** How the racket hand was held at the hit, from the body pose. Unknown when no pose was seen. */
  height?: HitHeight;
  /** The shot before this one in the rally, when it was named: an answer to a smash is a block, not a drive. */
  previous?: ShotType;
}

export interface ShotResult {
  type: ShotType;
  /** 0..1. Low means a guess from where and how fast only. */
  confidence: number;
  metres: number | null;
  kmh: number | null;
  /** How far from the net the hitter stood, in metres. */
  netDistance: number | null;
  /** A variant of the family, for example "low serve" or "high serve". */
  note?: string;
}

/** Hitters this far from the net or further are in the back court. */
const BACK_COURT_M = 5;
/** A shot hit this close to the net, and coming down this close to it, is a net shot. */
const NET_ZONE_M = 3.2;
/** Hit from this close to the net, a fast shot down is a kill. */
const KILL_ZONE_M = 3;
/** Coming down within this of the net is a front-court shot, beyond DEEP_M a deep one. */
const FRONT_M = 4;
const DEEP_M = 5;
const SMASH_KMH = 100;
const FAST_BACK_KMH = 140;
/** A shot that came down in the mid court and was hit hard is a push or drive; hard and quick up from the net is a flick. */
const PUSH_KMH = 60;
const FLICK_SECONDS = 0.9;
/** ...and a flick is at least this fast (a lift from the net is slower and higher). */
const FLICK_KMH = 80;
/** A block is a soft answer to a smash. */
const BLOCK_KMH = 80;

const distanceM = (a: Floor, b: Floor) => Math.hypot((b.u - a.u) * COURT_W, (b.v - a.v) * COURT_L);

/**
 * Names a shot. Rules, in this order (the confidence is lower without a body pose, and none of the limits has been tuned on real play):
 *  - the first shot of a rally is the serve (low if it came down short, high if deep and slow, flick if deep and quick, drive if in the middle);
 *  - an answer to a smash or a kill, hit low or at the side, that is slow or came down in the front court is a block;
 *  - hit above the head: close to the net (3 m or less) and fast is a kill; from the back court: down deep is a clear, else very fast a smash, else a drop; from the front half: 100 km/h or more a smash, else a clear if deep, else a drop;
 *  - hit low: close to the net and down in the front court is a net shot; down deep is a flick if it was quick (under 0.9 s), at least 80 km/h and was hit close to the net, otherwise a lift (a lob); a flat quick one a push close to the net, else a drive;
 *  - hit at the side: close to the net and down in the front court a net shot, down deep from the net a flick or lift, a quick one from the net a push, otherwise a drive.
 * With no pose the same signals are used without the hand height, and the confidence is lower.
 */
export function classifyShot(s: ShotInput): ShotResult {
  const metres = s.from && s.to ? distanceM(s.from, s.to) : null;
  const sp = s.from && s.to && s.seconds != null ? shotSpeed(s.from, s.to, s.seconds) : null;
  const kmh = sp ? sp.kmh : null;
  const net = s.from ? Math.abs(s.from.v - 0.5) * COURT_L : null;
  const out = (type: ShotType, confidence: number, note?: string): ShotResult => ({ type, confidence, metres, kmh, netDistance: net, ...(note ? { note } : {}) });

  // where the shuttle came down, as a distance from the net: this, more than the distance flown, says a clear from a drop
  const landNet = s.to ? Math.abs(s.to.v - 0.5) * COURT_L : null;
  const front = landNet != null ? landNet <= FRONT_M : metres != null && metres <= 5.5;
  const deep = landNet != null ? landNet >= DEEP_M : metres != null && metres >= 8;
  const mid = !front && !deep && landNet != null;
  const back = net != null && net >= BACK_COURT_M;
  const nearNet = net != null && net <= NET_ZONE_M;
  const killZone = net != null && net <= KILL_ZONE_M;
  const fast = kmh != null && kmh >= SMASH_KMH;
  const veryFast = kmh != null && kmh >= FAST_BACK_KMH;
  const quick = s.seconds != null && s.seconds <= FLICK_SECONDS;
  const flickFast = kmh != null && kmh >= FLICK_KMH;
  const slow = kmh != null && kmh < BLOCK_KMH;

  if (s.number === 1) {
    const note = front ? 'low serve' : deep ? (quick ? 'flick serve' : 'high serve') : mid ? 'drive serve' : undefined;
    return out('SERVE', 0.9, note);
  }
  const sure = s.height ? 1 : 0.55; // without a pose every call is less sure

  // answering a smash or a kill: soft and short, or flat and quick, but not hit above the head
  if ((s.previous === 'SMASH' || s.previous === 'KILL') && s.height !== 'overhead' && (front || slow)) {
    return out('BLOCK', 0.6 * sure);
  }

  switch (s.height) {
    case 'overhead':
      if (killZone && fast) return out('KILL', 0.7 * sure);
      if (back) {
        if (deep) return out('CLEAR', 0.8 * sure); // a clear flies as fast as a smash by this speed, so where it came down comes first
        if (veryFast) return out('SMASH', 0.7 * sure);
        if (front) return out('DROP', 0.7 * sure);
        return out(fast ? 'SMASH' : 'CLEAR', 0.5 * sure);
      }
      if (fast) return out('SMASH', 0.75 * sure);
      return out(deep ? 'CLEAR' : 'DROP', 0.55 * sure);
    case 'low':
      if (nearNet && front) return out('NET SHOT', 0.8 * sure);
      if (deep) return nearNet && quick && flickFast ? out('FLICK', 0.6 * sure) : out('LIFT', 0.7 * sure);
      if (nearNet && kmh != null && kmh >= PUSH_KMH) return out('PUSH', 0.6 * sure);
      if (fast) return out('DRIVE', 0.6 * sure);
      return out(nearNet ? 'NET SHOT' : 'DRIVE', 0.45 * sure);
    case 'side':
      if (nearNet && front) return out('NET SHOT', 0.6 * sure);
      if (nearNet && deep) return out(quick && flickFast ? 'FLICK' : 'LIFT', 0.5 * sure);
      if (nearNet && (mid || (kmh != null && kmh >= PUSH_KMH))) return out('PUSH', 0.55 * sure);
      return out('DRIVE', fast ? 0.65 * sure : 0.5 * sure);
  }
  // no pose: position, distance and speed only
  if (kmh != null && kmh >= 150 && !deep) return out('SMASH', 0.4);
  if (nearNet && front) return out('NET SHOT', 0.45);
  if (deep) return out(back ? 'CLEAR' : nearNet && quick && flickFast ? 'FLICK' : 'LIFT', 0.45);
  if (back && front && (kmh == null || kmh < 80)) return out('DROP', 0.4);
  if (nearNet && mid) return out('PUSH', 0.35);
  return out('DRIVE', 0.3);
}
