import type { ShotRecord } from './overlay';
import type { ShotEvent } from './shuttleStats';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const spot = (f: { u: number; v: number } | null) => (f ? { u: r3(f.u), v: r3(f.v) } : null);

/** A shot as saved with the game. `tMs` is when it was hit, in milliseconds since recording started. */
export function toShotRecord(e: ShotEvent, tMs: number, player: number | null): ShotRecord {
  return {
    t: Math.round(tMs), number: e.number, player, type: e.type,
    confidence: Math.round(e.confidence * 100) / 100,
    kmh: e.kmh == null ? null : Math.round(e.kmh),
    metres: e.metres == null ? null : r1(e.metres),
    ...(e.height ? { height: e.height } : {}),
    ...(e.pose ? { pose: e.pose } : {}),
    from: spot(e.from), to: spot(e.to),
  };
}
