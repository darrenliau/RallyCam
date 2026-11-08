import { describe, expect, it } from 'vitest';
import { addRally, newMatch } from './engine/scoring';
import type { MatchConfig } from './engine/types';
import { buildWatchState, parseWatchCommand, watchCommandAllowed, type WatchState } from './watchBridge';

const config: MatchConfig = { type: 'doubles', bestOf: 1, firstServer: 'A', players: { A: ['You', 'Mia'], B: ['Sam', 'Jun'] } };
const read = (json: string) => JSON.parse(json) as WatchState;

describe('buildWatchState', () => {
  it('has the score, the names, who serves, and the clock', () => {
    let state = newMatch(config);
    state = addRally(state, { winner: 'A', source: 'auto' });
    state = addRally(state, { winner: 'A', source: 'manual' });
    state = addRally(state, { winner: 'B', source: 'auto' });
    const w = read(buildWatchState({ state, recording: true, elapsedMs: 75_400, fps: 59.94, freeBytes: 12_345_678_901, locked: true, training: false }));
    expect(w).toMatchObject({ rec: true, secs: 75, a: 2, b: 1, nameA: 'You & Mia', nameB: 'Sam & Jun', serving: 'B', locked: true, points: 3, last: 'auto', training: false, fps: 60, freeMb: 12346 });
    expect(w.court === 'left' || w.court === 'right').toBe(true);
    expect(w.over).toBeUndefined();
  });
  it('says no point has been played yet, and leaves out what is not known', () => {
    const w = read(buildWatchState({ state: newMatch(config), recording: false, elapsedMs: 0, locked: false, training: true }));
    expect(w).toMatchObject({ rec: false, secs: 0, a: 0, b: 0, points: 0, last: 'none', locked: false, training: true });
    expect('fps' in w).toBe(false);
    expect('freeMb' in w).toBe(false);
  });
  it('names the winner when the game is over', () => {
    let state = newMatch(config);
    for (let i = 0; i < 21; i++) state = addRally(state, { winner: 'B', source: 'manual' });
    expect(read(buildWatchState({ state, recording: true, elapsedMs: 1000, locked: true, training: false })).over).toBe('B');
  });
});

describe('parseWatchCommand', () => {
  it('reads the four commands', () => {
    expect(parseWatchCommand({ command: 'point', side: 'B' })).toEqual({ kind: 'point', side: 'B' });
    expect(parseWatchCommand({ command: 'undo' })).toEqual({ kind: 'undo' });
    expect(parseWatchCommand({ command: 'swap' })).toEqual({ kind: 'swap' });
    expect(parseWatchCommand({ command: 'end' })).toEqual({ kind: 'end' });
  });
  it('ignores anything else, including a point with no side', () => {
    expect(parseWatchCommand({ command: 'point' })).toBeNull();
    expect(parseWatchCommand({ command: 'point', side: 'C' })).toBeNull();
    expect(parseWatchCommand({ command: 'explode' })).toBeNull();
    expect(parseWatchCommand({})).toBeNull();
  });
});

describe('watchCommandAllowed', () => {
  const base = { recording: true, over: false, training: false, ending: false, rallies: 3, lastSource: 'auto' as const };
  it('allows a point only while recording a game that is not over', () => {
    expect(watchCommandAllowed({ kind: 'point', side: 'A' }, base)).toBe(true);
    expect(watchCommandAllowed({ kind: 'point', side: 'A' }, { ...base, recording: false })).toBe(false);
    expect(watchCommandAllowed({ kind: 'point', side: 'A' }, { ...base, over: true })).toBe(false);
    expect(watchCommandAllowed({ kind: 'point', side: 'A' }, { ...base, training: true })).toBe(false);
  });
  it('allows undo only when there is a point to take back', () => {
    expect(watchCommandAllowed({ kind: 'undo' }, base)).toBe(true);
    expect(watchCommandAllowed({ kind: 'undo' }, { ...base, rallies: 0 })).toBe(false);
  });
  it('allows swap only for a point the camera gave', () => {
    expect(watchCommandAllowed({ kind: 'swap' }, base)).toBe(true);
    expect(watchCommandAllowed({ kind: 'swap' }, { ...base, lastSource: 'manual' })).toBe(false);
    expect(watchCommandAllowed({ kind: 'swap' }, { ...base, rallies: 0, lastSource: undefined })).toBe(false);
  });
  it('allows end while recording or when points were played, and nothing once it is already ending', () => {
    expect(watchCommandAllowed({ kind: 'end' }, base)).toBe(true);
    expect(watchCommandAllowed({ kind: 'end' }, { ...base, recording: false, rallies: 0 })).toBe(false);
    expect(watchCommandAllowed({ kind: 'end' }, { ...base, ending: true })).toBe(false);
    expect(watchCommandAllowed({ kind: 'point', side: 'A' }, { ...base, ending: true })).toBe(false);
  });
  it('lets training end', () => {
    expect(watchCommandAllowed({ kind: 'end' }, { ...base, training: true, rallies: 0 })).toBe(true);
  });
});
