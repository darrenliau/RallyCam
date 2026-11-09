import { describe, expect, it } from 'vitest';
import { toShotRecord } from './shotRecord';

describe('toShotRecord', () => {
  it('rounds the numbers and keeps the pose', () => {
    const r = toShotRecord({
      type: 'CLEAR', confidence: 0.8123, metres: 11.234, kmh: 139.6, netDistance: 6, number: 3, t: 12.5, track: 1,
      from: { u: 0.50012, v: 0.91234 }, to: { u: 0.4, v: 0.1 }, height: 'overhead', pose: [40, 1, 2],
    }, 12345.6, 0);
    expect(r).toEqual({
      t: 12346, number: 3, player: 0, type: 'CLEAR', confidence: 0.81, kmh: 140, metres: 11.2,
      height: 'overhead', pose: [40, 1, 2], from: { u: 0.5, v: 0.912 }, to: { u: 0.4, v: 0.1 },
    });
  });
  it('allows an unknown player, speed and landing', () => {
    const r = toShotRecord({ type: 'DRIVE', confidence: 0.3, metres: null, kmh: null, netDistance: null, number: 2, t: 1, from: null, to: null }, 10, null);
    expect(r.player).toBeNull();
    expect(r.kmh).toBeNull();
    expect(r.to).toBeNull();
    expect('pose' in r).toBe(false);
  });
});
