export type Side = 'A' | 'B';
export type MatchType = 'singles' | 'doubles';
export type Court = 'right' | 'left';

export interface MatchConfig {
  type: MatchType;
  /** Player names per side. Side A is the near side (closest to the camera). */
  players: { A: string[]; B: string[] };
  bestOf: 1 | 3;
  firstServer: Side;
}

/** One finished rally. Only `winner` matters for the score; the rest is analysis metadata. */
export interface Rally {
  winner: Side;
  startMs?: number;
  endMs?: number;
  shots?: number;
  /** 0-1. Low values are flagged for the user to check. */
  confidence?: number;
  source: 'auto' | 'manual';
}

export interface GameScore {
  A: number;
  B: number;
  winner?: Side;
}

export interface ServeInfo {
  side: Side;
  playerIndex: number;
  court: Court;
}

export interface MatchState {
  config: MatchConfig;
  rallies: Rally[];
  /** Completed games followed by the game in progress (if the match is not over). */
  games: GameScore[];
  serve: ServeInfo;
  matchWinner?: Side;
}
