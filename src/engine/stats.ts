import type { MatchState, Side } from './types';

export interface Progression {
  game: number;
  A: number[];
  B: number[];
}

/** Running score after every rally, one series per game, for the score chart. */
export function progression(state: MatchState): Progression[] {
  const out: Progression[] = [];
  let cur: Progression = { game: 1, A: [0], B: [0] };
  let a = 0;
  let b = 0;
  let gameNo = 1;
  let played = 0;
  for (const r of state.rallies) {
    if (r.winner === 'A') a++;
    else b++;
    cur.A.push(a);
    cur.B.push(b);
    played++;
    const g = state.games[gameNo - 1];
    if (g.winner && a === g.A && b === g.B && played === g.A + g.B) {
      out.push(cur);
      gameNo++;
      a = 0;
      b = 0;
      played = 0;
      cur = { game: gameNo, A: [0], B: [0] };
    }
  }
  if (cur.A.length > 1 || out.length === 0) out.push(cur);
  return out;
}

export function longestRun(state: MatchState): { side: Side; length: number } | undefined {
  let best: { side: Side; length: number } | undefined;
  let run = 0;
  let prev: Side | undefined;
  for (const r of state.rallies) {
    run = r.winner === prev ? run + 1 : 1;
    prev = r.winner;
    if (!best || run > best.length) best = { side: r.winner, length: run };
  }
  return best;
}

/**
 * `avgSeconds` is the average time per point. With scoring by tapping, a point's start is the previous tap, so this includes
 * the pause between rallies and is not the length of a rally. It becomes real rally length once rallies are detected
 * automatically (their start and end then come from the video).
 */
export function rallyStats(state: MatchState) {
  const timed = state.rallies.filter((r) => r.startMs != null && r.endMs != null);
  const secs = timed.map((r) => (r.endMs! - r.startMs!) / 1000);
  const shots = state.rallies.map((r) => r.shots).filter((n): n is number => n != null);
  return {
    count: state.rallies.length,
    avgSeconds: secs.length ? secs.reduce((x, y) => x + y, 0) / secs.length : undefined,
    longestShots: shots.length ? Math.max(...shots) : undefined,
    needsCheck: state.rallies.filter((r) => r.source === 'auto' && (r.confidence ?? 1) < 0.6).length,
  };
}
