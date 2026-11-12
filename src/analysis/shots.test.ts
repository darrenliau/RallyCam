import { describe, expect, it } from 'vitest';
import { classifyShot, type ShotInput } from './shots';

// v 0..1 along the court, the net at 0.5; 13.4 m long, so a back-court spot is about v 0.05 or 0.95
const back = { u: 0.5, v: 0.95 };
const mid = { u: 0.5, v: 0.75 };
const net = { u: 0.5, v: 0.62 };
const farBack = { u: 0.5, v: 0.05 };
const farNet = { u: 0.5, v: 0.4 };
const farMid = { u: 0.5, v: 0.28 };
const shot = (o: Partial<ShotInput>): ShotInput => ({ number: 2, from: back, to: farBack, seconds: 1.3, height: 'overhead', ...o });

describe('classifyShot', () => {
  it('calls the first shot the serve', () => {
    expect(classifyShot(shot({ number: 1, height: 'low' })).type).toBe('SERVE');
  });
  it('calls a long overhead shot from the back a clear', () => {
    const r = classifyShot(shot({}));
    expect(r.type).toBe('CLEAR');
    expect(r.confidence).toBeGreaterThan(0.7);
  });
  it('calls a short slow overhead shot from the back a drop', () => {
    expect(classifyShot(shot({ to: { u: 0.5, v: 0.4 }, seconds: 1.0 })).type).toBe('DROP');
  });
  it('calls a fast overhead shot from the front half a smash', () => {
    expect(classifyShot(shot({ from: mid, to: farMid, seconds: 0.45 })).type).toBe('SMASH');
  });
  it('calls a very fast overhead shot from the back a smash', () => {
    expect(classifyShot(shot({ to: { u: 0.5, v: 0.3 }, seconds: 0.4 })).type).toBe('SMASH');
  });
  it('calls a short low shot at the net a net shot', () => {
    expect(classifyShot(shot({ from: net, to: farNet, seconds: 0.8, height: 'low' })).type).toBe('NET SHOT');
  });
  it('calls a long low shot a lift', () => {
    expect(classifyShot(shot({ height: 'low', seconds: 1.4 })).type).toBe('LIFT');
  });
  it('calls a flat fast shot at the side a drive', () => {
    expect(classifyShot(shot({ from: mid, to: farMid, seconds: 0.5, height: 'side' })).type).toBe('DRIVE');
  });
  it('is less sure without a pose', () => {
    const withPose = classifyShot(shot({}));
    const without = classifyShot(shot({ height: undefined }));
    expect(without.type).toBe('CLEAR');
    expect(without.confidence).toBeLessThan(withPose.confidence);
  });
  it('reports how far and how fast', () => {
    const r = classifyShot(shot({}));
    expect(r.metres).toBeGreaterThan(11);
    expect(r.kmh).toBeGreaterThan(100);
    expect(r.netDistance).toBeCloseTo(6.03, 1);
  });
  it('still names a shot with no landing known', () => {
    expect(classifyShot(shot({ to: null, seconds: null })).type).toBeDefined();
  });

  describe('the other families', () => {
    const netMan = { u: 0.5, v: 0.6 };   // 1.3 m from the net
    it('calls a fast overhead shot from close to the net a kill', () => {
      expect(classifyShot(shot({ from: netMan, to: { u: 0.5, v: 0.2 }, seconds: 0.35, height: 'overhead' })).type).toBe('KILL');
    });
    it('calls a quick, fast, low shot from the net that goes deep a flick, and a slow one a lift', () => {
      const flick = classifyShot(shot({ from: netMan, to: farBack, seconds: 0.7, height: 'low' }));
      expect(flick.type).toBe('FLICK');
      const lift = classifyShot(shot({ from: netMan, to: farBack, seconds: 1.6, height: 'low' }));
      expect(lift.type).toBe('LIFT');
    });
    it('calls a flat quick low shot from the net into the middle a push', () => {
      expect(classifyShot(shot({ from: netMan, to: { u: 0.5, v: 0.13 }, seconds: 0.5, height: 'low' })).type).toBe('PUSH');
    });
    it('calls a soft low answer to a smash a block, and the same shot without a smash before it not a block', () => {
      const answer = shot({ from: mid, to: farNet, seconds: 1.0, height: 'low', previous: 'SMASH' });
      expect(classifyShot(answer).type).toBe('BLOCK');
      expect(classifyShot({ ...answer, previous: 'CLEAR' }).type).not.toBe('BLOCK');
    });
    it('does not call an overhead answer to a smash a block', () => {
      expect(classifyShot(shot({ from: back, to: farBack, seconds: 1.3, height: 'overhead', previous: 'SMASH' })).type).toBe('CLEAR');
    });
    it('notes which kind of serve it was', () => {
      expect(classifyShot(shot({ number: 1, from: net, to: farNet, seconds: 0.9, height: 'low' })).note).toBe('low serve');
      expect(classifyShot(shot({ number: 1, from: back, to: farBack, seconds: 1.6, height: 'overhead' })).note).toBe('high serve');
      expect(classifyShot(shot({ number: 1, from: back, to: farBack, seconds: 0.7, height: 'low' })).note).toBe('flick serve');
    });
    it('uses a lift for a deep shot from the front half without a pose, and a clear from the back', () => {
      expect(classifyShot(shot({ from: mid, to: farBack, seconds: 1.4, height: undefined })).type).toBe('LIFT');
      expect(classifyShot(shot({ from: back, to: farBack, height: undefined })).type).toBe('CLEAR');
    });
    it('keeps every result inside the known names', () => {
      const names = ['SERVE', 'SMASH', 'KILL', 'CLEAR', 'DROP', 'NET SHOT', 'LIFT', 'FLICK', 'PUSH', 'DRIVE', 'BLOCK'];
      for (const height of ['overhead', 'side', 'low', undefined] as const) for (const to of [farBack, farMid, farNet, { u: 0.9, v: 0.1 }, null]) for (const from of [back, mid, net, netMan, null]) {
        expect(names).toContain(classifyShot(shot({ from, to, height })).type);
      }
    });
  });
});
