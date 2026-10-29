import type { GameScore, MatchConfig, MatchState, Rally, ServeInfo, Side } from './types';

export const GAME_POINTS = 21;
export const GAME_CAP = 30;

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

export function isGameWon(a: number, b: number): Side | undefined {
  const top = Math.max(a, b);
  if (top < GAME_POINTS) return undefined;
  if (top >= GAME_CAP || Math.abs(a - b) >= 2) return a > b ? 'A' : 'B';
  return undefined;
}

/**
 * Rebuilds the whole match from the list of rallies. Undo, fixing a wrong point and
 * re-scoring after analysis changes all become "edit the list, then replay".
 */
export function replay(config: MatchConfig, rallies: Rally[]): MatchState {
  const doubles = config.type === 'doubles';
  const need = Math.ceil(config.bestOf / 2);
  const games: GameScore[] = [{ A: 0, B: 0 }];
  const wins = { A: 0, B: 0 };
  // Which player index stands in the right-hand court, per side (doubles only).
  const right = { A: 0, B: 0 };
  let serving: Side = config.firstServer;
  let matchWinner: Side | undefined;

  for (const rally of rallies) {
    if (matchWinner) break;
    const g = games[games.length - 1];
    const w = rally.winner;
    if (w === serving) right[w] ^= 1; // the serving side swaps courts after winning a point
    else serving = w; // service passes; nobody swaps
    g[w] += 1;

    const gw = isGameWon(g.A, g.B);
    if (gw) {
      g.winner = gw;
      wins[gw] += 1;
      if (wins[gw] >= need) {
        matchWinner = gw;
      } else {
        games.push({ A: 0, B: 0 });
        serving = gw; // winner of the last game serves first in the next
        right.A = 0;
        right.B = 0;
      }
    }
  }

  const cur = games[games.length - 1];
  const parity = cur[serving] % 2; // even score serves from the right court
  const playerIndex = doubles ? (parity === 0 ? right[serving] : right[serving] ^ 1) : 0;
  const serve: ServeInfo = { side: serving, playerIndex, court: parity === 0 ? 'right' : 'left' };

  return { config, rallies: [...rallies], games, serve, matchWinner };
}

export const newMatch = (config: MatchConfig): MatchState => replay(config, []);

export const addRally = (state: MatchState, rally: Rally): MatchState =>
  state.matchWinner ? state : replay(state.config, [...state.rallies, rally]);

export const undoLast = (state: MatchState): MatchState =>
  replay(state.config, state.rallies.slice(0, -1));

/** Replace one rally, for example when the user corrects the winner of a flagged point. */
export const editRally = (state: MatchState, index: number, patch: Partial<Rally>): MatchState =>
  replay(state.config, state.rallies.map((r, i) => (i === index ? { ...r, ...patch } : r)));

export const currentGame = (state: MatchState): GameScore => state.games[state.games.length - 1];

export const gamesWon = (state: MatchState): { A: number; B: number } => ({
  A: state.games.filter((g) => g.winner === 'A').length,
  B: state.games.filter((g) => g.winner === 'B').length,
});

export const serverName = (state: MatchState): string =>
  state.config.players[state.serve.side][state.serve.playerIndex];

export const sideLabel = (config: MatchConfig, side: Side): string => config.players[side].join(' & ');

export { other as otherSide };
