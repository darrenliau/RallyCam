import { describe, expect, it } from 'vitest';
import { COURT_L, COURT_W } from './court';
import { DRAG_LENGTH_M, shotSpeed } from './shotSpeed';

// Two players `metres` apart along the court
const along = (metres: number) => ({ from: { u: 0.5, v: 0.9 }, to: { u: 0.5, v: 0.9 - metres / COURT_L } });

describe('shotSpeed', () => {
  it('turns a smash into a believable start speed', () => {
    const { from, to } = along(9);
    const r = shotSpeed(from, to, 0.45)!;
    expect(r.metres).toBeCloseTo(9, 3);
    expect(r.kmh).toBeGreaterThan(200); // about 62 m/s
    expect(r.kmh).toBeLessThan(250);
  });
  it('gives a clear from baseline to baseline about 130 km/h, and a drop shot far less', () => {
    const clear = along(11);
    const c = shotSpeed(clear.from, clear.to, 1.3)!;
    expect(c.kmh).toBeGreaterThan(115);
    expect(c.kmh).toBeLessThan(145);
    const drop = along(4);
    const d = shotSpeed(drop.from, drop.to, 0.9)!;
    expect(d.kmh).toBeGreaterThan(18);
    expect(d.kmh).toBeLessThan(35);
  });
  it('is faster than distance over time, because drag slows the shuttle on the way', () => {
    const { from, to } = along(9);
    const r = shotSpeed(from, to, 0.45)!;
    expect(r.kmh).toBeGreaterThan((9 / 0.45) * 3.6);
  });
  it('agrees with the drag model it is built from', () => {
    // fly a shuttle with v' = -v^2 / L from 50 m/s for 0.8 s and see that the speed comes back
    const v0 = 50, T = 0.8;
    const distance = DRAG_LENGTH_M * Math.log(1 + (v0 * T) / DRAG_LENGTH_M);
    const r = shotSpeed({ u: 0.5, v: 0.9 }, { u: 0.5, v: 0.9 - distance / COURT_L }, T)!;
    expect(r.kmh / 3.6).toBeCloseTo(v0, 3);
  });
  it('works across the court as well as along it', () => {
    const r = shotSpeed({ u: 0.1, v: 0.5 }, { u: 0.1 + 4 / COURT_W, v: 0.5 }, 0.3)!;
    expect(r.metres).toBeCloseTo(4, 3);
  });
  it('says nothing when the numbers cannot be right', () => {
    const { from, to } = along(9);
    expect(shotSpeed(from, to, 0.05)).toBeNull();   // two hits at once: one is not real
    expect(shotSpeed(from, to, 5)).toBeNull();      // the rally had stopped
    expect(shotSpeed(from, from, 0.5)).toBeNull();  // the same spot
    const far = along(15);
    expect(shotSpeed(far.from, far.to, 0.2)).toBeNull(); // faster than any shot there has been
  });
});
