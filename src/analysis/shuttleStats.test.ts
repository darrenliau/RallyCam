import { describe, expect, it } from 'vitest';
import { COURT_L, COURT_W } from './court';
import { ShuttleEstimator } from './shuttleStats';

const identity = (x: number, y: number) => ({ u: x, v: y });

/** Shuttle flying left to right across a 0..1 frame in `secs` seconds, sampled at 60 Hz. */
function fly(est: ShuttleEstimator, from: number, to: number, startT: number, secs: number, y = 0.5) {
  const n = Math.round(secs * 60);
  for (let i = 0; i <= n; i++) est.push({ t: startT + i / 60, x: from + ((to - from) * i) / n, y });
  return startT + secs;
}

describe('ShuttleEstimator', () => {
  it('estimates speed from how far the shuttle moves across the court per second', () => {
    const est = new ShuttleEstimator(identity);
    const end = fly(est, 0.2, 0.8, 0, 0.5);
    const s = est.stats(end)!;
    const expectedKmh = (0.6 * COURT_W) / 0.5 * 3.6; // 0.6 of the court width in half a second
    expect(s.speedKmh).toBeGreaterThan(expectedKmh * 0.9);
    expect(s.speedKmh).toBeLessThan(expectedKmh * 1.1);
  });

  it('counts the serve and then a shot each time the shuttle turns around', () => {
    const est = new ShuttleEstimator(identity);
    let t = fly(est, 0.2, 0.8, 0, 0.5); // serve
    t = fly(est, 0.8, 0.2, t + 1 / 60, 0.5); // returned
    t = fly(est, 0.2, 0.8, t + 1 / 60, 0.5); // returned again
    expect(est.stats(t)!.shots).toBe(3);
  });

  it('reports the speed of the last shot after the shuttle turns', () => {
    const est = new ShuttleEstimator(identity);
    let t = fly(est, 0.1, 0.9, 0, 0.15); // fast: about 117 km/h
    t = fly(est, 0.9, 0.6, t + 1 / 60, 0.6); // slow return
    const s = est.stats(t)!;
    expect(s.speedKmh).toBeGreaterThan(80); // the fast shot, not the slow one
    expect(s.speedKmh).toBeLessThan(160);
  });

  it('shows nothing once the shuttle has not been seen for over a second', () => {
    const est = new ShuttleEstimator(identity);
    const end = fly(est, 0.2, 0.8, 0, 0.3);
    expect(est.stats(end + 0.5)).not.toBeNull();
    expect(est.stats(end + 2)).toBeNull();
  });

  it('starts counting again after a point', () => {
    const est = new ShuttleEstimator(identity);
    let t = fly(est, 0.2, 0.8, 0, 0.4);
    t = fly(est, 0.8, 0.2, t + 1 / 60, 0.4);
    est.newRally();
    t = fly(est, 0.2, 0.8, t + 0.5, 0.4);
    expect(est.stats(t)!.shots).toBe(1);
  });

  it('ignores impossible jumps in speed', () => {
    const est = new ShuttleEstimator(identity);
    est.push({ t: 0, x: 0.1, y: 0.5 });
    est.push({ t: 0.017, x: 0.1, y: 0.5 });
    est.push({ t: 0.034, x: 0.9, y: 0.5 }); // 4.9 m in 17 ms is nonsense
    expect(est.stats(0.034)!.speedKmh).toBeLessThan(1);
    expect(COURT_L).toBeGreaterThan(0);
  });

  it('keeps a short trail of recent positions', () => {
    const est = new ShuttleEstimator(identity);
    const end = fly(est, 0.1, 0.9, 0, 1);
    const trail = est.trail(end, 0.3);
    expect(trail.length).toBeGreaterThan(10);
    expect(trail.length).toBeLessThan(25);
    expect(trail[trail.length - 1].x).toBeCloseTo(0.9, 5);
  });
});
