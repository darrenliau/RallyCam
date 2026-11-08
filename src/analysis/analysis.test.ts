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
  it('works when the horizon passes exactly through the image origin', () => {
    // These corners vanish at y = 0, which broke a solver that fixed one matrix entry to 1
    const c = { farLeft: { x: 576, y: 432 }, farRight: { x: 1344, y: 432 }, nearRight: { x: 1824, y: 972 }, nearLeft: { x: 96, y: 972 } };
    const m = courtMap(c);
    const p = m.toScreen(0.3, 0.7);
    const back = m.toCourt(p);
    expect(back.u).toBeCloseTo(0.3, 6);
    expect(back.v).toBeCloseTo(0.7, 6);
    expect(m.toScreen(1, 1).x).toBeCloseTo(1824, 6);
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
  it('counts nothing for a player standing still with a jittery position', () => {
    const m = new DistanceMeter();
    const owner = (id: number) => id;
    let seed = 3;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
    for (let i = 0; i < 2000; i++) m.update([{ id: 0, u: 0.5 + rand() * 0.04, v: 0.5 + rand() * 0.015 }], owner); // wobble of about 12 cm
    expect(m.metres(0)).toBe(0);
  });
  it('counts a steady walk to within one step', () => {
    const m = new DistanceMeter();
    const owner = (id: number) => id;
    for (let i = 0; i <= 50; i++) m.update([{ id: 0, u: 0.5, v: 0.2 + i * (0.0075) }], owner); // 0.1 m a look, 5 m in all
    expect(m.metres(0)).toBeGreaterThan(4.4);
    expect(m.metres(0)).toBeLessThanOrEqual(5.1);
  });
  it('does not count while a player is not seen', () => {
    const m = new DistanceMeter();
    const owner = (id: number) => id;
    m.update([{ id: 0, u: 0.5, v: 0.5 }], owner);
    m.update([{ id: 0, u: 0.5, v: 0.6, lost: 3 }], owner);
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
