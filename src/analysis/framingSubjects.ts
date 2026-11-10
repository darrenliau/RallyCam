import { COURT_W, type CourtMap } from './court';
import type { Subject } from './framing';
import type { Track } from './players';
import { screenToFrame } from './preprocess';
import type { FrameGeometry } from './tracker';

/** A body is about this tall (metres): the head is this far above the feet. */
const BODY_M = 1.7;

/**
 * The points of the full picture the view must hold for each tracked player: the feet and the top of the head (and a little above, for a
 * racket raised in a smash). `map` and `g` are those of the reference (full) picture. A player who is not seen at the moment is left out.
 * `velocityOf` gives a player's speed in frame fractions a second, so the view can widen ahead of a running player.
 */
export function playerSubjects(tracks: Track[], map: CourtMap, g: FrameGeometry, velocityOf?: (id: number) => { vx: number; vy: number } | undefined): Subject[] {
  const out: Subject[] = [];
  for (const t of tracks) {
    if (t.lost) continue;
    const feet = map.toScreen(t.u, t.v);
    const along = map.toScreen(t.u + 0.05, t.v);
    const ppm = Math.hypot(along.x - feet.x, along.y - feet.y) / (0.05 * COURT_W);
    if (!(ppm > 0)) continue;
    const f = screenToFrame(feet, g);
    const h = screenToFrame({ x: feet.x, y: feet.y - BODY_M * 1.15 * ppm }, g);
    // a running player is expected to be further along soon: the view widens before they reach the edge
    const v = velocityOf?.(t.id);
    out.push({ ...f, ...(v ?? {}), kind: 'player' }, { ...h, ...(v ?? {}), kind: 'player' });
  }
  return out;
}

/** The shuttle, with its speed from its last two positions (frame fractions, seconds apart), as something to keep in view. */
export function shuttleSubject(trail: { x: number; y: number }[], seconds: number): Subject | null {
  if (!trail.length) return null;
  const last = trail[trail.length - 1];
  if (trail.length < 2 || !(seconds > 0)) return { ...last, kind: 'shuttle' };
  const first = trail[0];
  return { ...last, vx: (last.x - first.x) / seconds, vy: (last.y - first.y) / seconds, kind: 'shuttle' };
}
