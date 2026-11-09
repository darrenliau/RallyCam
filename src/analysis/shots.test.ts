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
  it('calls a long low shot a clear (a lift)', () => {
    expect(classifyShot(shot({ height: 'low', seconds: 1.4 })).type).toBe('CLEAR');
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
});
