import { describe, expect, it } from 'vitest';
import { describeLastGame, lastGameConfig, parseLastGame, type LastGame } from './lastGame';

const last: LastGame = { type: 'doubles', players: { A: ['You', 'Mia'], B: ['Sam', 'Jun'] }, venueId: 'v1', venueName: 'Tuesday hall' };

describe('parseLastGame', () => {
  it('reads back what was saved', () => {
    expect(parseLastGame(JSON.stringify(last))).toEqual(last);
  });
  it('keeps only as many players as the game type has', () => {
    const singles = parseLastGame(JSON.stringify({ ...last, type: 'singles' }))!;
    expect(singles.players).toEqual({ A: ['You'], B: ['Sam'] });
  });
  it('gives nothing for empty, damaged or odd values', () => {
    for (const bad of ['', 'not json', 'null', '{}', JSON.stringify({ ...last, type: 'triples' }), JSON.stringify({ ...last, players: { A: [], B: ['Sam'] } }), JSON.stringify({ ...last, players: { A: ['You', ' '], B: ['Sam'] } })]) {
      expect(parseLastGame(bad)).toBeUndefined();
    }
    expect(parseLastGame(undefined)).toBeUndefined();
  });
  it('does without a venue', () => {
    const noVenue = parseLastGame(JSON.stringify({ type: 'singles', players: { A: ['You'], B: ['Sam'] } }))!;
    expect(noVenue.venueId).toBeUndefined();
  });
});

describe('lastGameConfig', () => {
  it('makes a one game match, or training with no score', () => {
    expect(lastGameConfig(last, false)).toEqual({ type: 'doubles', bestOf: 1, firstServer: 'A', players: last.players });
    expect(lastGameConfig(last, true).training).toBe(true);
  });
  it('does not share the saved player lists', () => {
    const c = lastGameConfig(last, false);
    c.players.A.push('X');
    expect(last.players.A).toEqual(['You', 'Mia']);
  });
});

describe('describeLastGame', () => {
  it('names both sides', () => expect(describeLastGame(last)).toBe('You & Mia vs Sam & Jun'));
});
