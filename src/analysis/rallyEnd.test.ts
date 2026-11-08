import { describe, expect, it } from 'vitest';
import { judgeRally, judgeServe, landingCall, serveCall, serveProblem, isRallyOver, isContinuation, GONE_S, GONE_MAX_S, LANDED_S, CONTINUE_S } from './rallyEnd';
import { COURT_L, COURT_W } from './court';

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

describe('serveProblem', () => {
  const trace = (u: number, v: number) => ({ shots: 3, lastHit: P(2, 0.5, 0.2), lastSeen: P(3, 0.5, 0.8), firstSeen: P(1, u, v) });
  it('accepts a serve from the expected side and court', () => {
    // near side server, right court = right half of the picture
    expect(serveProblem(trace(0.7, 0.8), { side: 'A', court: 'right' })).toBeNull();
    expect(serveProblem(trace(0.3, 0.8), { side: 'A', court: 'left' })).toBeNull();
  });
  it('rejects movement that starts on the other side', () => {
    expect(serveProblem(trace(0.7, 0.2), { side: 'A', court: 'right' })).not.toBeNull();
  });
  it('rejects a start from the wrong court', () => {
    expect(serveProblem(trace(0.2, 0.8), { side: 'A', court: 'right' })).not.toBeNull();
  });
  it('mirrors left and right for the far side', () => {
    expect(serveProblem(trace(0.3, 0.2), { side: 'B', court: 'right' })).toBeNull();
    expect(serveProblem(trace(0.7, 0.2), { side: 'B', court: 'right' })).not.toBeNull();
  });
  it('rejects a start far from the server when the server is known', () => {
    expect(serveProblem(trace(0.7, 0.8), { side: 'A', court: 'right', server: { u: 0.1, v: 0.9 } })).not.toBeNull();
    expect(serveProblem(trace(0.7, 0.8), { side: 'A', court: 'right', server: { u: 0.65, v: 0.82 } })).toBeNull();
  });
  it('has nothing to judge before a start is seen', () => {
    expect(serveProblem({ shots: 0, lastHit: null, lastSeen: null }, { side: 'A', court: 'right' })).not.toBeNull();
  });
  it('knows when a rally is over', () => {
    const t = trace(0.7, 0.8);
    expect(isRallyOver(t, 3.5)).toBe(false);
    expect(isRallyOver(t, 3 + GONE_S + 0.1)).toBe(true);
  });
});

describe('ending a rally at the landing', () => {
  const landed = (v: number, extra: object = {}) => ({ shots: 4, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, v), descending: true, ...extra });

  it('calls the rally soon after a clear landing, without the long wait', () => {
    const t = landed(0.25);
    expect(isRallyOver(t, 2 + LANDED_S + 0.05, false)).toBe(true);
    expect(judgeRally(t, 2 + LANDED_S + 0.05, false)).toMatchObject({ winner: 'A' });
    expect(LANDED_S).toBeLessThan(GONE_S);
  });
  it('waits a little first, in case the shuttle comes back', () => {
    expect(isRallyOver(landed(0.25), 2 + LANDED_S - 0.2, false)).toBe(false);
  });
  it('uses the long wait when the shuttle was not coming down', () => {
    expect(isRallyOver(landed(0.25, { descending: false }), 2 + LANDED_S + 0.05, false)).toBe(false);
    expect(isRallyOver(landed(0.25, { descending: false }), 2 + GONE_S + 0.05, false)).toBe(true);
  });
  it('uses the long wait when the landing is close to a line or the net', () => {
    expect(isRallyOver(landed(0.03), 2 + LANDED_S + 0.05, false)).toBe(false); // just inside the far baseline
    expect(isRallyOver(landed(0.52), 2 + LANDED_S + 0.05, false)).toBe(false); // by the net
    expect(isRallyOver(landed(0.03), 2 + GONE_S + 0.05, false)).toBe(true);
  });
  it('calls a clearly out landing early too', () => {
    const v = judgeRally(landed(-0.12), 2 + LANDED_S + 0.05, false)!;
    expect(v.winner).toBe('B'); // A hit it out
  });
  it('does not end a rally with too few shots early', () => {
    expect(isRallyOver(landed(0.25, { shots: 1 }), 2 + LANDED_S + 0.05, false)).toBe(false);
  });
});

describe('players still moving or stopped', () => {
  const t = { shots: 4, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.25), descending: true };

  it('waits while the players are still running, even after a clear landing', () => {
    expect(isRallyOver(t, 2 + LANDED_S + 0.05, false, false)).toBe(false);
    expect(isRallyOver(t, 2 + GONE_S + 0.1, false, false)).toBe(false);
  });
  it('still gives up after a while, so a stuck player cannot hold a point forever', () => {
    expect(isRallyOver(t, 2 + GONE_MAX_S + 0.1, false, false)).toBe(true);
  });
  it('is unchanged when the players are stopped or nothing is known', () => {
    expect(isRallyOver(t, 2 + LANDED_S + 0.05, false, true)).toBe(true);
    expect(isRallyOver(t, 2 + LANDED_S + 0.05, false, undefined)).toBe(true);
  });
  it('is more sure of a point when the players stopped, less when they were still moving', () => {
    const at = 2 + GONE_MAX_S + 0.1;
    const none = judgeRally(t, at, false)!.confidence;
    expect(judgeRally(t, at, false, true)!.confidence).toBeGreaterThan(none);
    expect(judgeRally(t, at, false, false)!.confidence).toBeLessThan(none);
  });
});

describe('a rally cut short', () => {
  const landing = { u: 0.5, v: 0.3 };
  it('is when the shuttle comes back soon, near where it was lost, and players are still moving', () => {
    expect(isContinuation(landing, { u: 0.55, v: 0.35 }, 1, false)).toBe(true);
    expect(isContinuation(landing, { u: 0.55, v: 0.35 }, 1, undefined)).toBe(true);
  });
  it('is not when the players have stopped (a new serve is coming)', () => {
    expect(isContinuation(landing, { u: 0.55, v: 0.35 }, 1, true)).toBe(false);
  });
  it('is not when it comes back late or far away', () => {
    expect(isContinuation(landing, { u: 0.55, v: 0.35 }, CONTINUE_S + 0.5, false)).toBe(false);
    expect(isContinuation(landing, { u: 0.5, v: 0.9 }, 1, false)).toBe(false);
  });
});

describe('a shuttle that may be in the air', () => {
  const base = { shots: 4, lastHit: P(1, 0.5, 0.8), descending: true };

  it('is not called when the shuttle vanished in the air and no floor sighting was just before', () => {
    const trace = { ...base, lastSeen: { ...P(2, 0.5, 1.49), air: true }, lastFloor: P(0.5, 0.5, 0.8) };
    expect(judgeRally(trace, 2 + GONE_MAX_S + 0.1, false)).toBeNull();
  });
  it('uses the last floor sighting just before, with less confidence', () => {
    const direct = judgeRally({ ...base, lastSeen: P(2, 0.5, 0.25) }, 2 + GONE_S + 0.1, false)!;
    const indirect = judgeRally({ ...base, lastSeen: { ...P(2, 0.5, 1.49), air: true }, lastFloor: P(1.5, 0.5, 0.25) }, 2 + GONE_S + 0.1, false)!;
    expect(indirect.winner).toBe(direct.winner);
    expect(indirect.confidence).toBeLessThan(direct.confidence);
  });
  it('does not take the quick landing call for a shuttle last seen in the air', () => {
    const trace = { ...base, lastSeen: { ...P(2, 0.5, 0.25), air: true } };
    expect(isRallyOver(trace, 2 + LANDED_S + 0.05, false)).toBe(false);
    expect(isRallyOver(trace, 2 + GONE_S + 0.1, false)).toBe(true);
  });
  it('is not called when nothing says who hit it last: the hit was in the air and no player was named', () => {
    const trace = { ...base, lastHit: { ...P(1, 0.5, 0.8), air: true }, lastSeen: P(2, 0.5, 0.25) };
    expect(judgeRally(trace, 2 + GONE_S + 0.1, false)).toBeNull();
  });
  it('takes the hitter from the caller when it is named', () => {
    const trace = { ...base, lastHit: { ...P(1, 0.5, 0.8), air: true }, lastSeen: P(2, 0.5, 0.25) };
    expect(judgeRally(trace, 2 + GONE_S + 0.1, false, undefined, 'A')).toMatchObject({ winner: 'A' }); // A hit it into B's court, in
    expect(judgeRally(trace, 2 + GONE_S + 0.1, false, undefined, 'B')).toMatchObject({ winner: 'A' }); // B hit it onto B's own side: A wins
  });
  it('cannot check where a serve began if its first sighting was in the air', () => {
    const t = { shots: 3, lastHit: null, lastSeen: P(3, 0.5, 0.2), firstSeen: { ...P(1, 0.1, 1.4), air: true } };
    expect(serveProblem(t, { side: 'A', court: 'right' })).toBeNull();
  });
});


describe('lines are part of the court', () => {
  it('a shuttle exactly on a line is in', () => {
    expect(landingCall({ u: 0, v: 0.5 }, false).inBounds).toBe(true);          // on the doubles side line
    expect(landingCall({ u: 0.5, v: 0 }, false).inBounds).toBe(true);          // on the back line
    expect(landingCall({ u: 0.46 / COURT_W, v: 0.3 }, true).inBounds).toBe(true); // on the singles side line, in singles
    expect(landingCall({ u: -0.01, v: 0.5 }, false).inBounds).toBe(false);
  });
});

describe('serveCall', () => {
  const m = (u: number, v: number) => ({ u: u / COURT_W, v: v / COURT_L });  // metres across from the left side, along from the far baseline
  const near = { side: 'A' as const, court: 'right' as const };            // near server in the right court (the picture's right half)
  it('a good serve lands in the diagonal court: the picture\'s left half, far end, beyond the short line', () => {
    expect(serveCall(m(1.5, 2.5), near, false).inCourt).toBe(true);
    expect(serveCall(m(1.5, 2.5), near, true).inCourt).toBe(true);
  });
  it('the wrong diagonal court is a fault', () => {
    expect(serveCall(m(4.5, 2.5), near, false).inCourt).toBe(false); // straight ahead, not across
  });
  it('short of the short service line is a fault', () => {
    expect(serveCall(m(1.5, COURT_L / 2 - 1.5), near, false).inCourt).toBe(false); // 1.5 m from the net
    expect(serveCall(m(1.5, COURT_L / 2 - 2.2), near, false).inCourt).toBe(true);  // 2.2 m from the net
  });
  it('past the doubles long service line is a fault in doubles but fine in singles', () => {
    const longServe = m(1.5, 0.4); // 0.4 m from the back line
    expect(serveCall(longServe, near, false).inCourt).toBe(false);
    expect(serveCall(longServe, near, true).inCourt).toBe(true);
  });
  it('the singles side lines are the edge of the court in singles only', () => {
    const wide = m(0.2, 2.5);
    expect(serveCall(wide, near, false).inCourt).toBe(true);
    expect(serveCall(wide, near, true).inCourt).toBe(false);
  });
  it('mirrors for the far server: its right court is the picture\'s left half and it serves to the picture\'s right', () => {
    const far = { side: 'B' as const, court: 'right' as const };
    expect(serveCall(m(4.5, COURT_L - 2.5), far, false).inCourt).toBe(true);
    expect(serveCall(m(1.5, COURT_L - 2.5), far, false).inCourt).toBe(false);
  });
  it('coming down on the server\'s own side is a fault', () => {
    expect(serveCall(m(1.5, COURT_L - 2.5), near, false).inCourt).toBe(false);
  });
});

describe('judgeServe', () => {
  const m = (u: number, v: number) => ({ u: u / COURT_W, v: v / COURT_L });
  const serve = { side: 'A' as const, court: 'right' as const };
  const trace = (landing: { u: number; v: number }) => ({ shots: 1, lastHit: P(1, 0.7, 0.9), firstSeen: P(1, 0.7, 0.9), lastSeen: P(1.6, landing.u, landing.v), lastFloor: P(1.6, landing.u, landing.v), descending: true });
  it('an unreturned serve that came down in the right court is the server\'s point', () => {
    const v = judgeServe(trace(m(1.5, 2.5)), now(1.6), false, serve)!;
    expect(v.winner).toBe('A');
    expect(v.reason).toContain('not returned');
  });
  it('a long, short, wide or wrong-court serve is the receiver\'s point', () => {
    for (const bad of [m(1.5, 0.3), m(1.5, COURT_L / 2 - 1), m(4.5, 2.5), m(1.5, COURT_L - 2.5)]) {
      expect(judgeServe(trace(bad), now(1.6), false, serve)!.winner).toBe('B');
    }
  });
  it('is less sure than a longer rally, and less sure near a line', () => {
    const sure = judgeServe(trace(m(1.5, 2.5)), now(1.6), false, serve)!;
    const close = judgeServe(trace(m(1.5, COURT_L / 2 - 2.0)), now(1.6), false, serve)!; // just past the short service line
    expect(sure.confidence).toBeLessThan(0.8);
    expect(close.confidence).toBeLessThan(sure.confidence);
  });
  it('waits until the rally is over, and says nothing for a shuttle that came down nowhere we saw', () => {
    expect(judgeServe(trace(m(1.5, 2.5)), 1.7, false, serve)).toBeNull();
    expect(judgeServe({ shots: 1, lastHit: P(1, 0.7, 0.9), lastSeen: { t: 1.6, u: 0.3, v: 0.3, air: true } }, now(1.6), false, serve)).toBeNull();
  });
  it('is for a serve only: a rally with returns goes to judgeRally', () => {
    expect(judgeServe({ ...trace(m(1.5, 2.5)), shots: 3 }, now(1.6), false, serve)).toBeNull();
  });
  it('is less sure when the shuttle changed direction away from the players', () => {
    const plain = judgeServe(trace(m(1.5, 2.5)), now(1.6), false, serve)!;
    const strays = judgeServe({ ...trace(m(1.5, 2.5)), strays: 1 }, now(1.6), false, serve)!;
    expect(strays.confidence).toBeLessThan(plain.confidence);
  });
});

describe('judgeRally and shuttle turns with nobody near', () => {
  it('is less sure of a point when the shuttle turned away from the players', () => {
    const base = { shots: 5, lastHit: P(1, 0.5, 0.8), lastSeen: P(2, 0.5, 0.3) };
    expect(judgeRally({ ...base, strays: 1 }, now(2), false)!.confidence).toBeLessThan(judgeRally(base, now(2), false)!.confidence);
  });
});
