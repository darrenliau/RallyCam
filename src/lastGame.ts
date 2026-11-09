import type { MatchConfig, MatchType } from './engine/types';

/** The setup of the last game that was started, kept so that the watch can start another one with the same players and venue. */
export interface LastGame {
  type: MatchType;
  players: { A: string[]; B: string[] };
  venueId?: string;
  venueName?: string;
}

const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every((x) => typeof x === 'string' && x.trim() !== '');

/** Reads what was saved (JSON text). Anything that does not look like a game setup gives undefined, so a damaged value never breaks the app. */
export function parseLastGame(raw: string | undefined | null): LastGame | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<LastGame> | null;
    if (!v || (v.type !== 'singles' && v.type !== 'doubles') || !v.players || !isNames(v.players.A) || !isNames(v.players.B)) return undefined;
    const n = v.type === 'singles' ? 1 : 2;
    return {
      type: v.type,
      players: { A: v.players.A.slice(0, n), B: v.players.B.slice(0, n) },
      ...(typeof v.venueId === 'string' && v.venueId ? { venueId: v.venueId } : {}),
      ...(typeof v.venueName === 'string' && v.venueName ? { venueName: v.venueName } : {}),
    };
  } catch {
    return undefined;
  }
}

/** The game to start, from the saved setup: one game (the recording stops when someone wins it), or training with no score. */
export function lastGameConfig(last: LastGame, training: boolean): MatchConfig {
  return {
    type: last.type,
    bestOf: 1,
    firstServer: 'A',
    ...(training ? { training: true } : {}),
    players: { A: [...last.players.A], B: [...last.players.B] },
  };
}

/** "You & Mia vs Sam & Jun" */
export const describeLastGame = (last: LastGame): string => `${last.players.A.join(' & ')} vs ${last.players.B.join(' & ')}`;
