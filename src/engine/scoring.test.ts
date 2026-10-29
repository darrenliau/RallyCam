import { describe, expect, it } from 'vitest';
import { addRally, currentGame, editRally, gamesWon, isGameWon, newMatch, serverName, undoLast } from './scoring';
import { longestRun, progression } from './stats';
import type { MatchConfig, MatchState, Side } from './types';

const singles: MatchConfig = { type: 'singles', players: { A: ['You'], B: ['Sam'] }, bestOf: 3, firstServer: 'A' };
const doubles: MatchConfig = { type: 'doubles', players: { A: ['Ann', 'Ben'], B: ['Cat', 'Dan'] }, bestOf: 3, firstServer: 'A' };

const play = (s: MatchState, winners: string): MatchState =>
  [...winners].reduce((st, w) => addRally(st, { winner: w as Side, source: 'manual' }), s);
const rep = (w: Side, n: number) => w.repeat(n);

describe('game rules', () => {
  it('wins at 21 with a 2 point lead', () => {
    expect(isGameWon(21, 19)).toBe('A');
    expect(isGameWon(21, 20)).toBeUndefined();
    expect(isGameWon(22, 20)).toBe('A');
    expect(isGameWon(20, 22)).toBe('B');
  });
  it('is decided at 30 even with a 1 point lead', () => {
    expect(isGameWon(29, 29)).toBeUndefined();
    expect(isGameWon(30, 29)).toBe('A');
  });
});

describe('singles', () => {
  it('serves from the court that matches the server score and passes service on a lost rally', () => {
    let s = newMatch(singles);
    expect(s.serve).toMatchObject({ side: 'A', court: 'right' });
    s = play(s, 'A');
    expect(s.serve).toMatchObject({ side: 'A', court: 'left' }); // 1-0
    s = play(s, 'B');
    expect(s.serve).toMatchObject({ side: 'B', court: 'left' }); // 1-1, B has 1 point
    s = play(s, 'B');
    expect(s.serve).toMatchObject({ side: 'B', court: 'right' }); // B has 2
  });
  it('plays a best-of-3 and stops scoring after the match is won', () => {
    let s = newMatch(singles);
    s = play(s, rep('A', 21));
    expect(gamesWon(s)).toEqual({ A: 1, B: 0 });
    expect(currentGame(s)).toEqual({ A: 0, B: 0 });
    expect(s.serve.side).toBe('A'); // game winner serves first
    s = play(s, rep('B', 21));
    s = play(s, rep('B', 21));
    expect(s.matchWinner).toBe('B');
    expect(play(s, 'A').rallies.length).toBe(s.rallies.length);
  });
  it('handles deuce', () => {
    const s = play(newMatch(singles), rep('A', 20) + rep('B', 20) + 'AB' + 'AA');
    expect(s.games[0]).toMatchObject({ A: 23, B: 21, winner: 'A' });
  });
});

describe('doubles', () => {
  it('the serving side swaps courts after winning a point, the receiving side does not', () => {
    let s = newMatch(doubles);
    expect(serverName(s)).toBe('Ann'); // 0-0, right court, first player
    s = play(s, 'A'); // 1-0, Ann swapped to the left court, Ben is on the right; odd score serves from left
    expect(s.serve).toMatchObject({ side: 'A', court: 'left' });
    expect(serverName(s)).toBe('Ann');
    s = play(s, 'A'); // 2-0, Ann back on the right
    expect(serverName(s)).toBe('Ann');
    expect(s.serve.court).toBe('right');
    s = play(s, 'B'); // service to B at 0-1... B has 1 point: odd, left court
    expect(s.serve).toMatchObject({ side: 'B', court: 'left' });
    expect(serverName(s)).toBe('Dan'); // B players start with index 0 on the right, so left court is Dan
  });
});

describe('undo and edit', () => {
  it('undo restores the earlier state exactly', () => {
    const base = play(newMatch(doubles), 'AABABB');
    const undone = undoLast(play(base, 'A'));
    expect(undone.games).toEqual(base.games);
    expect(undone.serve).toEqual(base.serve);
  });
  it('fixing a wrong point re-scores everything after it', () => {
    const s = play(newMatch(singles), 'AAB');
    const fixed = editRally(s, 2, { winner: 'A' });
    expect(currentGame(fixed)).toEqual({ A: 3, B: 0 });
    expect(fixed.serve.side).toBe('A');
  });
});

describe('stats', () => {
  it('builds a score progression per game and finds the longest run', () => {
    const s = play(newMatch(singles), rep('A', 21) + 'BBB');
    const p = progression(s);
    expect(p.length).toBe(2);
    expect(p[0].A.at(-1)).toBe(21);
    expect(p[1].B).toEqual([0, 1, 2, 3]);
    expect(longestRun(s)).toEqual({ side: 'A', length: 21 });
  });
});
