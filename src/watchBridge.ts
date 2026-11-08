import { currentGame, serverName, sideLabel } from './engine/scoring';
import type { MatchState, Side } from './engine/types';

/** What the watch app is told about the game, a few times a second. Short names keep it small; the watch reads the same keys (targets/watch/RallyState.swift). */
export interface WatchState {
  /** Recording now. */
  rec: boolean;
  /** Seconds recorded. */
  secs: number;
  /** Score of the side nearest the camera (A) and of the other side (B) in the game being played. */
  a: number;
  b: number;
  /** Who is on each side, for the buttons: "You & Mia". */
  nameA: string;
  nameB: string;
  /** Which side serves and from which court, and who. */
  serving: Side;
  court: 'left' | 'right';
  server: string;
  fps?: number;
  /** Free storage in megabytes, to warn when it runs low. */
  freeMb?: number;
  /** The court has been locked, so recording can start. */
  locked: boolean;
  /** Points played so far. It changes with every point, which is how the watch knows to tap the wrist. */
  points: number;
  /** How the last point was given: by the camera ("auto"), by hand ("manual"), or none yet. */
  last: 'auto' | 'manual' | 'none';
  /** The side that has won the game, once it is over. */
  over?: Side;
  /** Training: nothing is scored. */
  training: boolean;
}

export function buildWatchState(input: {
  state: MatchState;
  recording: boolean;
  elapsedMs: number;
  fps?: number;
  freeBytes?: number;
  locked: boolean;
  training: boolean;
}): string {
  const { state } = input;
  const game = currentGame(state);
  const last = state.rallies[state.rallies.length - 1];
  const out: WatchState = {
    rec: input.recording,
    secs: Math.max(0, Math.floor(input.elapsedMs / 1000)),
    a: game.A,
    b: game.B,
    nameA: sideLabel(state.config, 'A'),
    nameB: sideLabel(state.config, 'B'),
    serving: state.serve.side,
    court: state.serve.court,
    server: serverName(state) ?? '',
    ...(input.fps != null ? { fps: Math.round(input.fps) } : {}),
    ...(input.freeBytes != null && Number.isFinite(input.freeBytes) ? { freeMb: Math.round(input.freeBytes / 1e6) } : {}),
    locked: input.locked,
    points: state.rallies.length,
    last: last ? last.source : 'none',
    ...(state.matchWinner ? { over: state.matchWinner } : {}),
    training: input.training,
  };
  return JSON.stringify(out);
}

export type WatchCommand = { kind: 'point'; side: Side } | { kind: 'undo' } | { kind: 'swap' } | { kind: 'end' };

/** Reads a message from the watch. Anything that is not one of the four commands is ignored. */
export function parseWatchCommand(message: { command?: string; side?: string }): WatchCommand | null {
  switch (message.command) {
    case 'point':
      return message.side === 'A' || message.side === 'B' ? { kind: 'point', side: message.side } : null;
    case 'undo':
      return { kind: 'undo' };
    case 'swap':
      return { kind: 'swap' };
    case 'end':
      return { kind: 'end' };
    default:
      return null;
  }
}

/**
 * Whether a command makes sense right now. A watch can be raised at any moment, so presses that do not fit are dropped rather than
 * acted on: a point before recording has started, or after the game is won, or in Training where nothing is scored.
 */
export function watchCommandAllowed(
  cmd: WatchCommand,
  now: { recording: boolean; over: boolean; training: boolean; ending: boolean; rallies: number; lastSource?: 'auto' | 'manual' },
): boolean {
  if (now.ending) return false;
  switch (cmd.kind) {
    case 'point':
      return now.recording && !now.over && !now.training;
    case 'undo':
      return now.rallies > 0 && !now.training;
    case 'swap':
      return now.rallies > 0 && now.lastSource === 'auto' && !now.training;
    case 'end':
      return now.recording || now.rallies > 0;
  }
}
