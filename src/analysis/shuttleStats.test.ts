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

  it('ignores things that are far outside the court, like the next court\'s players', () => {
    const est = new ShuttleEstimator(identity);
    // a fast "shuttle" well to the left of the court, then one beyond the far baseline
    for (let i = 0; i < 20; i++) est.push({ t: i / 60, x: -1 + i * 0.01, y: 0.5 });
    for (let i = 0; i < 20; i++) est.push({ t: 1 + i / 60, x: 0.5, y: -1 - i * 0.01 });
    expect(est.stats(1.4)).toBeNull();
    expect(est.trace().shots).toBe(0);
    expect(est.trail(1.4)).toEqual([]);
  });

  it('still takes a shuttle a little outside the lines', () => {
    const est = new ShuttleEstimator(identity);
    const end = fly(est, -0.2, 0.3, 0, 0.4, 0.5);
    expect(est.stats(end)).not.toBeNull();
  });

  it('does not report an impossible speed, but keeps a record-breaking smash', () => {
    const impossible = new ShuttleEstimator(identity);
    const end = fly(impossible, 0, 1, 0, 0.03, 0.5); // the whole court width in 30 ms: ~200 m/s
    expect(impossible.stats(end)?.speedKmh ?? 0).toBeLessThan(10);
    const smash = new ShuttleEstimator(identity);
    const end2 = fly(smash, 0.1, 0.9, 0, 0.12, 0.5); // 0.8 of the court width (4.9 m) in 120 ms: ~41 m/s
    expect(smash.stats(end2)!.speedKmh).toBeGreaterThan(130);
  });

  describe('on the court map', () => {
    /** Shuttle falling straight down the picture at `x`, from y0 to y1. */
    const fall = (est: ShuttleEstimator, x: number, y0: number, y1: number, startT: number, secs: number) => {
      const n = Math.round(secs * 60);
      for (let i = 0; i <= n; i++) est.push({ t: startT + i / 60, x, y: y0 + ((y1 - y0) * i) / n });
      return startT + secs;
    };

    it('is flying (in play) while it is being tracked', () => {
      const est = new ShuttleEstimator(identity);
      const end = fly(est, 0.2, 0.8, 0, 0.5);
      expect(est.onMap(end + 0.05, false)).toMatchObject({ phase: 'flying' });
    });

    it('shows where it came down, inside the lines, when it is lost while going down', () => {
      const est = new ShuttleEstimator(identity);
      fly(est, 0.3, 0.5, 0, 0.4, 0.5);
      const end = fall(est, 0.5, 0.5, 0.9, 0.4, 0.3);
      const m = est.onMap(end + 0.6, false)!;
      expect(m.phase).toBe('landed');
      expect(m.u).toBeCloseTo(0.5, 2);
      expect(m.v).toBeCloseTo(0.9, 2);
      expect(m.inBounds).toBe(true);
    });

    it('calls a landing beyond the baseline out', () => {
      const est = new ShuttleEstimator(identity);
      fly(est, 0.3, 0.5, 0, 0.4, 0.5);
      const end = fall(est, 0.5, 0.8, 1.06, 0.4, 0.3);
      expect(est.onMap(end + 0.6, false)).toMatchObject({ phase: 'landed', inBounds: false });
    });

    it('stops showing the landing after a few seconds', () => {
      const est = new ShuttleEstimator(identity);
      fly(est, 0.3, 0.5, 0, 0.4, 0.5);
      const end = fall(est, 0.5, 0.5, 0.9, 0.4, 0.3);
      expect(est.onMap(end + 5, false)).toBeNull();
    });

    it('shows nothing for a shuttle lost while going up (behind a player, out of the picture)', () => {
      const est = new ShuttleEstimator(identity);
      const n = 24;
      for (let i = 0; i <= n; i++) est.push({ t: i / 60, x: 0.4 + i * 0.005, y: 0.6 - (i * 0.2) / n });
      expect(est.onMap(n / 60 + 0.6, false)).toBeNull();
    });

    it('tells the scorer whether the shuttle was coming down when it was lost', () => {
      const down = new ShuttleEstimator(identity);
      fly(down, 0.3, 0.5, 0, 0.4, 0.5);
      fall(down, 0.5, 0.5, 0.9, 0.4, 0.3);
      expect(down.trace().descending).toBe(true);
      const up = new ShuttleEstimator(identity);
      for (let i = 0; i <= 24; i++) up.push({ t: i / 60, x: 0.4 + i * 0.005, y: 0.6 - (i * 0.2) / 24 });
      expect(up.trace().descending).toBe(false);
    });

    it('shows nothing before any shuttle has been seen, and after a new rally starts', () => {
      const est = new ShuttleEstimator(identity);
      expect(est.onMap(1, false)).toBeNull();
      fly(est, 0.2, 0.8, 0, 0.5);
      est.newRally();
      expect(est.onMap(0.6, false)).toBeNull();
    });
  });
});
