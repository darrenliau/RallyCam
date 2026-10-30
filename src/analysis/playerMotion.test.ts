import { describe, expect, it } from 'vitest';
import { PlayerMotion } from './playerMotion';
import type { Track } from './players';

/** Players sampled at 15 Hz. `pos(i)` gives each player's court position at sample i. */
function run(pm: PlayerMotion, from: number, secs: number, pos: (t: number) => Track[]) {
  const n = Math.round(secs * 15);
  for (let i = 0; i <= n; i++) pm.push(from + i / 15, pos(from + i / 15));
  return from + secs;
}
const still = (): Track[] => [{ id: 0, u: 0.3, v: 0.8 }, { id: 1, u: 0.7, v: 0.2 }];
/** A player sprinting at about 1.8 m/s along the court width. */
const running = (t: number): Track[] => [{ id: 0, u: 0.1 + 0.3 * t, v: 0.8 }, { id: 1, u: 0.7, v: 0.2 }];

describe('PlayerMotion', () => {
  it('says calm when everyone is standing still, even with detector jitter', () => {
    const pm = new PlayerMotion();
    const end = run(pm, 0, 2, (t) => [{ id: 0, u: 0.3 + 0.001 * Math.sin(t * 50), v: 0.8 }, { id: 1, u: 0.7, v: 0.2 + 0.001 * Math.cos(t * 40) }]);
    expect(pm.calm(end, 1.5)).toBe(true);
  });
  it('says not calm while a player is running', () => {
    const pm = new PlayerMotion();
    const end = run(pm, 0, 2, running);
    expect(pm.calm(end, 1.5)).toBe(false);
    expect(pm.activity(end, 1.5)!).toBeGreaterThan(1.5);
  });
  it('notices that players stopped after a rally', () => {
    const pm = new PlayerMotion();
    let t = run(pm, 0, 2, running);
    t = run(pm, t, 2, () => [{ id: 0, u: 0.4, v: 0.8 }, { id: 1, u: 0.7, v: 0.2 }]);
    expect(pm.calm(t, 1.5)).toBe(true);
    expect(pm.calm(t - 2, 1.5)).toBe(false); // while the rally was on
  });
  it('is unknown with no tracking or too little data', () => {
    const pm = new PlayerMotion();
    expect(pm.calm(1, 1)).toBeUndefined();
    pm.push(0.9, still());
    pm.push(1, still());
    expect(pm.calm(1, 1)).toBeUndefined();
  });
  it('ignores players that are lost, and forgets old data on reset', () => {
    const pm = new PlayerMotion();
    const end = run(pm, 0, 2, () => [{ id: 0, u: 0.3, v: 0.8, lost: 5 }]);
    expect(pm.calm(end, 1.5)).toBeUndefined();
    pm.reset();
    expect(pm.activity(end, 5)).toBeUndefined();
  });
});
