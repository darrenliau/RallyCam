import { describe, expect, it } from 'vitest';
import { bridgeGaps, fitPath, looksLikeFlight, type PathPoint } from './shuttlePath';

/** A lob: moves right at 600 px/s, rises then falls like a parabola. */
const lob = (n: number, dt = 1 / 60, jitter = (_i: number) => 0): PathPoint[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i * dt;
    return { t, x: 100 + 600 * t + jitter(i), y: 400 - 900 * t + 1500 * t * t + jitter(i + 7) };
  });

describe('fitPath', () => {
  it('fits a parabola exactly', () => {
    const f = fitPath(lob(12))!;
    expect(f.rms).toBeLessThan(1e-6);
    expect(f.at(0.1).x).toBeCloseTo(160, 4);
  });
  it('needs at least four points', () => {
    expect(fitPath(lob(3))).toBeNull();
  });
  it('reports how far noisy points are from the curve', () => {
    const f = fitPath(lob(20, 1 / 60, (i) => (i % 2 ? 2 : -2)))!;
    expect(f.rms).toBeGreaterThan(0.5);
    expect(f.rms).toBeLessThan(4);
  });
});

describe('looksLikeFlight', () => {
  it('accepts a smooth flight, with a little measurement noise', () => {
    expect(looksLikeFlight(lob(10))).toBe(true);
    expect(looksLikeFlight(lob(10, 1 / 60, (i) => (i % 3) - 1))).toBe(true);
  });
  it('rejects hops between unrelated specks', () => {
    const noise: PathPoint[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ t: i / 60, x: 100 + ((i * 97) % 5) * 60, y: 300 + ((i * 53) % 7) * 40 }));
    expect(looksLikeFlight(noise)).toBe(false);
  });
  it('rejects a path that zig-zags even though each step is a plausible size', () => {
    const zig: PathPoint[] = Array.from({ length: 10 }, (_, i) => ({ t: i / 60, x: 100 + i * 20, y: 300 + (i % 2 ? 25 : -25) }));
    expect(looksLikeFlight(zig)).toBe(false);
  });
  it('accepts a fast straight smash', () => {
    const smash: PathPoint[] = Array.from({ length: 8 }, (_, i) => ({ t: i / 60, x: 100 + i * 90, y: 200 + i * 40 }));
    expect(looksLikeFlight(smash)).toBe(true);
  });
  it('does not judge a path that is too short', () => {
    expect(looksLikeFlight(lob(3))).toBe(true);
  });
});

describe('bridgeGaps', () => {
  it('adds points along the curve where the shuttle was missed, but not across long gaps', () => {
    const pts = lob(20);
    const holey = [...pts.slice(0, 8), ...pts.slice(12)]; // four frames missing
    const filled = bridgeGaps(holey, 1 / 60, 0.2);
    expect(filled.length).toBeGreaterThanOrEqual(holey.length + 3);
    for (const p of filled) {
      const truth = pts.find((q) => Math.abs(q.t - p.t) < 1e-9);
      if (truth) expect(Math.hypot(p.x - truth.x, p.y - truth.y)).toBeLessThan(1);
    }
    const far = [...pts.slice(0, 5), ...pts.slice(18)];
    expect(bridgeGaps(far, 1 / 60, 0.1)).toHaveLength(far.length); // 13 frames is longer than the allowed gap
  });
});
