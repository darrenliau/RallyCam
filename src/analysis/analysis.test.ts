import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners, denormalizeCorners, normalizeCorners } from './court';
import { DistanceMeter } from './players';

describe('court mapping', () => {
  const corners = defaultCorners(400, 800);
  const map = courtMap(corners);
  it('sends court corners to the chosen screen corners', () => {
    expect(map.toScreen(0, 0).x).toBeCloseTo(corners.farLeft.x, 6);
    expect(map.toScreen(1, 0).y).toBeCloseTo(corners.farRight.y, 6);
    expect(map.toScreen(1, 1).x).toBeCloseTo(corners.nearRight.x, 6);
    expect(map.toScreen(0, 1).y).toBeCloseTo(corners.nearLeft.y, 6);
  });
  it('round-trips between screen and court', () => {
    const s = map.toScreen(0.3, 0.7);
    const c = map.toCourt(s);
    expect(c.u).toBeCloseTo(0.3, 6);
    expect(c.v).toBeCloseTo(0.7, 6);
  });
  it('shows the far half of the court smaller than the near half (perspective)', () => {
    const farHalf = map.toScreen(0.5, 0.5).y - map.toScreen(0.5, 0).y;
    const nearHalf = map.toScreen(0.5, 1).y - map.toScreen(0.5, 0.5).y;
    expect(nearHalf).toBeGreaterThan(farHalf);
  });
  it('rejects collapsed corners', () => {
    const p = { x: 1, y: 1 };
    expect(() => courtMap({ farLeft: p, farRight: p, nearRight: p, nearLeft: p })).toThrow();
  });
});

describe('DistanceMeter', () => {
  it('adds up movement in metres and credits the tagged player', () => {
    const m = new DistanceMeter();
    const owner = (id: number) => id;
    m.update([{ id: 0, u: 0.5, v: 0.5 }], owner);
    m.update([{ id: 0, u: 0.5, v: 0.6 }], owner); // 0.1 of 13.4 m = 1.34 m
    expect(m.metres(0)).toBeCloseTo(1.34, 2);
  });
  it('ignores jitter and impossible jumps', () => {
    const m = new DistanceMeter();
    const owner = (id: number) => id;
    m.update([{ id: 0, u: 0.5, v: 0.5 }], owner);
    m.update([{ id: 0, u: 0.5, v: 0.501 }], owner);
    m.update([{ id: 0, u: 0.5, v: 0.9 }], owner);
    expect(m.metres(0)).toBe(0);
  });
  it('follows a swapped tag', () => {
    const m = new DistanceMeter();
    let swapped = false;
    const owner = (id: number) => (swapped ? 1 - id : id);
    m.update([{ id: 0, u: 0.5, v: 0.5 }], owner);
    swapped = true;
    m.update([{ id: 0, u: 0.5, v: 0.6 }], owner);
    expect(m.metres(1)).toBeGreaterThan(1);
    expect(m.metres(0)).toBe(0);
  });
});

describe('saved court corners', () => {
  it('round-trips through fractions of the screen', () => {
    const c = defaultCorners(800, 400);
    const back = denormalizeCorners(normalizeCorners(c, 800, 400), 800, 400);
    expect(back.nearLeft.x).toBeCloseTo(c.nearLeft.x, 9);
    expect(back.farRight.y).toBeCloseTo(c.farRight.y, 9);
  });
  it('scales to a different screen size', () => {
    const n = normalizeCorners(defaultCorners(800, 400), 800, 400);
    const big = denormalizeCorners(n, 1600, 800);
    expect(big.farLeft.x).toBeCloseTo(defaultCorners(1600, 800).farLeft.x, 9);
  });
});
