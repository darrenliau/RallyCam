import type { Court, Side } from '../engine/types';

/** Slack on the centre line (as a fraction of the court's width) when telling a server's left court from the right one. */
const CENTRE_SLACK = 0.06;

/**
 * Which court (left or right, as the server sees it) a player standing at court position `u` is in. A near-side server (A) faces
 * away from the camera, so their right is the camera's right; for the far side it is the other way round. Returns undefined
 * when the player is on the centre line.
 */
export function courtOfServer(side: Side, u: number): Court | undefined {
  if (Math.abs(u - 0.5) <= CENTRE_SLACK) return undefined;
  const cameraRight = u > 0.5;
  return (side === 'A') === cameraRight ? 'right' : 'left';
}

export interface InferredWinner { winner: Side; confidence: number; reason: string }

/**
 * In rally scoring the side that wins a point serves next. So when a rally ended with no clear winner (the shuttle was lost in
 * the air), whoever serves the next rally won it.
 *
 * `expected` says, for each side, who would serve next and from which court if that side had won the point (the game engine knows
 * this from the score). `observed` is who was seen serving: the side of the player nearest the shuttle at the serve, and which court
 * they stood in. The side decides the winner. If the court they stood in is also the one the score says that side would serve
 * from, it is much more likely to be right: two things agree. If it is the other court, something is off (a different shot was
 * taken for the serve, or a point was missed) and the confidence is low.
 */
export function inferWinnerFromServe(
  expected: Record<Side, { side: Side; court: Court }>,
  observed: { side: Side; court?: Court },
): InferredWinner {
  const e = expected[observed.side];
  if (observed.court === undefined) return { winner: observed.side, confidence: 0.55, reason: 'served next' };
  if (observed.court === e.court) return { winner: observed.side, confidence: 0.8, reason: 'served next from the right court' };
  return { winner: observed.side, confidence: 0.35, reason: 'served next, but from the other court' };
}
