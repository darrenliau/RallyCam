import { COURT_L, COURT_W } from './court';
import type { HitHeight } from './pose';
import { shotSpeed, type Floor } from './shotSpeed';

export type ShotType = 'SERVE' | 'SMASH' | 'CLEAR' | 'DROP' | 'NET SHOT' | 'DRIVE';

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
}

export interface ShotResult {
  type: ShotType;
  /** 0..1. Low means a guess from where and how fast only. */
  confidence: number;
  metres: number | null;
  kmh: number | null;
  /** How far from the net the hitter stood, in metres. */
  netDistance: number | null;
}

/** Hitters this far from the net or further are in the back court. */
const BACK_COURT_M = 5;
/** A shot hit this close to the net, and coming down this close to it, is a net shot. */
const NET_ZONE_M = 3.2;
/** Coming down within this of the net is a front-court shot, beyond DEEP_M a deep one. */
const FRONT_M = 4;
const DEEP_M = 5;
const SMASH_KMH = 100;
const FAST_BACK_KMH = 140;

const distanceM = (a: Floor, b: Floor) => Math.hypot((b.u - a.u) * COURT_W, (b.v - a.v) * COURT_L);

/**
 * Names a shot. The body pose tells how it was hit (above the head, at the side, low), the two spots on the floor say how far it went,
 * and the time between the hits and the speed (see shotSpeed.ts) how hard. Rules, in this order:
 *  - the first shot of a rally is the serve;
 *  - hit above the head: from the back court: down deep (5 m or more from the net) is a clear, otherwise very fast is a smash and down in the front court a drop; from the front half: 100 km/h or more is a smash, else a clear if deep and a drop if not;
 *  - hit low: close to the net and coming down in the front court is a net shot, one that came down deep is a clear (a lift), a flat fast one a drive;
 *  - hit at the side: a net shot near the net if it stayed in the front court, otherwise a drive.
 * With no pose only position, distance and speed are used, and the confidence is lower. None of the limits has been tuned on real play.
 */
export function classifyShot(s: ShotInput): ShotResult {
  const metres = s.from && s.to ? distanceM(s.from, s.to) : null;
  const sp = s.from && s.to && s.seconds != null ? shotSpeed(s.from, s.to, s.seconds) : null;
  const kmh = sp ? sp.kmh : null;
  const net = s.from ? Math.abs(s.from.v - 0.5) * COURT_L : null;
  const out = (type: ShotType, confidence: number): ShotResult => ({ type, confidence, metres, kmh, netDistance: net });

  if (s.number === 1) return out('SERVE', 0.9);
  const sure = s.height ? 1 : 0.55; // without a pose every call is less sure
  // where the shuttle came down, as a distance from the net: this, more than the distance flown, says a clear from a drop
  const landNet = s.to ? Math.abs(s.to.v - 0.5) * COURT_L : null;
  const front = landNet != null ? landNet <= FRONT_M : metres != null && metres <= 5.5;
  const deep = landNet != null ? landNet >= DEEP_M : metres != null && metres >= 8;
  const back = net != null && net >= BACK_COURT_M;
  const nearNet = net != null && net <= NET_ZONE_M;
  const fast = kmh != null && kmh >= SMASH_KMH;
  const veryFast = kmh != null && kmh >= FAST_BACK_KMH;

  switch (s.height) {
    case 'overhead':
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
      if (deep) return out('CLEAR', 0.65 * sure); // a lift
      if (fast) return out('DRIVE', 0.6 * sure);
      return out(nearNet ? 'NET SHOT' : 'DRIVE', 0.45 * sure);
    case 'side':
      if (nearNet && front) return out('NET SHOT', 0.6 * sure);
      return out('DRIVE', fast ? 0.65 * sure : 0.5 * sure);
  }
  // no pose: position, distance and speed only
  if (kmh != null && kmh >= 150 && !deep) return out('SMASH', 0.4);
  if (nearNet && front) return out('NET SHOT', 0.45);
  if (deep) return out('CLEAR', 0.45);
  if (back && front && (kmh == null || kmh < 80)) return out('DROP', 0.4);
  return out('DRIVE', 0.3);
}
