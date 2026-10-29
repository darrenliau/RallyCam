import { describe, expect, it } from 'vitest';
import { judgeRally, GONE_S } from './rallyEnd';

const P = (t: number, u: number, v: number) => ({ t, u, v });
const now = (t: number) => t + GONE_S + 0.1;

describe('judgeRally', () => {
  it('waits until the shuttle has been gone a while', () => {
    expect(judgeRally({ shots: 4, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.2) }, 2.5, false)).toBeNull();
  });
  it('ignores rallies with too few shots', () => {
    expect(judgeRally({ shots: 1, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.2) }, now(2), false)).toBeNull();
  });
  it('near player wins when the shuttle lands inside the far court', () => {
    const v = judgeRally({ shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.2) }, now(2), false)!;
    expect(v.winner).toBe('A');
    expect(v.confidence).toBeGreaterThan(0.6);
  });
  it('far player wins when it lands inside the near court', () => {
    expect(judgeRally({ shots: 5, lastHit: P(1, 0.5, 0.2), lastSeen: P(2, 0.4, 0.85) }, now(2), false)!.winner).toBe('B');
  });
  it('hitting it out loses the point', () => {
    const v = judgeRally({ shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, -0.1) }, now(2), false)!;
    expect(v.winner).toBe('B');
  });
  it('into the net loses the point', () => {
    const v = judgeRally({ shots: 4, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.62) }, now(2), false)!;
    expect(v.winner).toBe('B');
  });
  it('the doubles tram lines are out in singles only', () => {
    const t = { shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.04, 0.2) };
    expect(judgeRally(t, now(2), false)!.winner).toBe('A');
    expect(judgeRally(t, now(2), true)!.winner).toBe('B');
  });
  it('is less sure near a line', () => {
    const sure = judgeRally({ shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.3) }, now(2), false)!;
    const close = judgeRally({ shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.02) }, now(2), false)!;
    expect(close.confidence).toBeLessThan(sure.confidence);
  });
});
