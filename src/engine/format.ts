import { currentGame, gamesWon } from './scoring';
import type { MatchState } from './types';

/** "21–17" for a one-game match, otherwise "2–1" plus each game's score. */
export function resultLine(state: MatchState): string {
  if (state.config.bestOf === 1) {
    const g = currentGame(state);
    return `${g.A}–${g.B}`;
  }
  const w = gamesWon(state);
  return `${w.A}–${w.B}`;
}

export const gameScores = (state: MatchState): string =>
  state.games.filter((g) => g.A + g.B > 0).map((g) => `${g.A}–${g.B}`).join(', ');

export const formatClock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const describeMatch = (state: MatchState): string => {
  const { A, B } = state.config.players;
  return `${A.join(' & ')} vs ${B.join(' & ')}`;
};
