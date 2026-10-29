import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners } from './court';
import { cornersInBox, cornersToFrame, snapshotAt, stateAt, type OverlaySnapshot } from './overlay';
import { screenToFrame } from './preprocess';
import type { MatchConfig, Rally } from '../engine/types';

const snap = (t: number): OverlaySnapshot => ({ t, tracks: [], assign: [], dist: [] });

describe('snapshotAt', () => {
  const snaps = [snap(0), snap(250), snap(500), snap(5000)];
  it('finds the newest snapshot at or before the time', () => {
    expect(snapshotAt(snaps, 260)?.t).toBe(250);
    expect(snapshotAt(snaps, 500)?.t).toBe(500);
    expect(snapshotAt(snaps, 5100)?.t).toBe(5000);
  });
  it('returns nothing before the first snapshot or when the newest is too old', () => {
    expect(snapshotAt(snaps, -5)).toBeUndefined();
    expect(snapshotAt(snaps, 3000)).toBeUndefined(); // 2.5 s after the last one at 500
    expect(snapshotAt([], 100)).toBeUndefined();
  });
});

describe('stateAt', () => {
  const config: MatchConfig = { type: 'singles', players: { A: ['You'], B: ['Sam'] }, bestOf: 1, firstServer: 'A' };
  const rallies: Rally[] = [
    { winner: 'A', startMs: 0, endMs: 1000, source: 'manual' },
    { winner: 'B', startMs: 1000, endMs: 2000, source: 'manual' },
    { winner: 'A', startMs: 2000, endMs: 3000, source: 'manual' },
  ];
  it('shows the score as it was at that moment of the video', () => {
    expect(stateAt(config, rallies, 500).games[0]).toMatchObject({ A: 0, B: 0 });
    expect(stateAt(config, rallies, 1000).games[0]).toMatchObject({ A: 1, B: 0 });
    expect(stateAt(config, rallies, 2500).games[0]).toMatchObject({ A: 1, B: 1 });
    expect(stateAt(config, rallies, 99999).games[0]).toMatchObject({ A: 2, B: 1 });
  });
});

describe('court corners in the video', () => {
  it('maps the same court spot to the same place on screen and in the video box', () => {
    const g = { frameAspect: 16 / 9, screenW: 900, screenH: 400 };
    const screenCorners = defaultCorners(900, 400);
    const inFrame = cornersToFrame(screenCorners, g);
    // Draw the court in a 16:9 box the size of the frame: a corner must land on screenToFrame of the screen corner.
    const box = cornersInBox(inFrame, 1600, 900);
    const expected = screenToFrame(screenCorners.nearRight, g);
    expect(box.nearRight.x).toBeCloseTo(expected.x * 1600, 6);
    expect(box.nearRight.y).toBeCloseTo(expected.y * 900, 6);
    const map = courtMap(box);
    expect(map.toScreen(1, 1).x).toBeCloseTo(box.nearRight.x, 6);
  });
});
