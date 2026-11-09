import { COURT_W, type CourtMap, type Pt } from './court';
import type { Track } from './players';
import type { Side } from '../engine/types';

/**
 * Beyond this many body heights from every player, the shuttle was not hit by anyone we are tracking. A racket reaches about a body
 * height from the feet in any direction (a smash is above the head, a net shot is out in front), measured to the top of the body, so a
 * real hit is within about one. It was 2.5, which let the shuttles of the next court count as hits whenever one of our players was
 * in the same part of the picture: in a recording in a hall with several courts, hits at 1.4 to 2.5 body heights were all on other
 * courts, and the ones at 0.1 to 0.9 were the player's own.
 */
const MAX_BODY_HEIGHTS = 1.2;

/**
 * Which side hit the shuttle: the side of the player nearest to it in the picture at that moment. This uses the picture, not the
 * floor, because a shuttle that is high is nowhere near its floor position, while the player who hit it is close to it in the
 * picture whatever the camera's height.
 *
 * `shuttle` is a point on the same screen the court map uses. Distance is measured to the player's body, from the feet up to
 * well above the head, in body heights (a body is taken to be 1.7 m, scaled to the picture at the player's depth), so a player
 * at the far end, who is small, is not beaten by a large player near the camera who happens to be close on screen.
 * Returns undefined when nobody is near enough.
 */
export function hitterSide(shuttle: Pt, tracks: Track[], map: CourtMap): { side: Side; distance: number; track: Track } | undefined {
  let best: { side: Side; distance: number; track: Track } | undefined;
  for (const t of tracks) {
    if (t.lost) continue;
    const feet = map.toScreen(t.u, t.v);
    const along = map.toScreen(t.u + 0.05, t.v);
    const pixelsPerMetre = Math.hypot(along.x - feet.x, along.y - feet.y) / (0.05 * COURT_W);
    const body = 1.7 * pixelsPerMetre;
    if (!(body > 1)) continue;
    const top = feet.y - 1.3 * body;           // reach above the head
    const bottom = feet.y + 0.2 * body;
    const dy = shuttle.y < top ? top - shuttle.y : shuttle.y > bottom ? shuttle.y - bottom : 0;
    const dx = Math.abs(shuttle.x - feet.x);
    const distance = Math.hypot(dx, dy) / body;
    if (!best || distance < best.distance) best = { side: t.v >= 0.5 ? 'A' : 'B', distance, track: t };
  }
  return best && best.distance <= MAX_BODY_HEIGHTS ? best : undefined;
}
