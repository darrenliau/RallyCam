import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners } from './court';
import { followCorners, judgeShift } from './courtFollow';
import type { FrameGeometry } from './tracker';

const g: FrameGeometry = { frameAspect: 16 / 9, screenW: 800, screenH: 450 };

describe('followCorners', () => {
  const c = defaultCorners(800, 450);
  it('moves every corner by the same distance on the screen', () => {
    const f = followCorners(c, { dx: 0.1, dy: -0.05 }, g);
    for (const k of ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const) {
      expect(f[k].x - c[k].x).toBeCloseTo(80, 6);       // 10% of an 800 wide screen that shows the whole frame
      expect(f[k].y - c[k].y).toBeCloseTo(-22.5, 6);    // 5% of 450
    }
  });
  it('keeps the court the same shape', () => {
    const a = courtMap(c).toScreen(0.5, 0.5), b = courtMap(followCorners(c, { dx: 0.02, dy: 0.01 }, g)).toScreen(0.5, 0.5);
    expect(b.x - a.x).toBeCloseTo(16, 6);
    expect(b.y - a.y).toBeCloseTo(4.5, 6);
  });
  it('allows for the crop on a screen wider than the camera picture', () => {
    const wide: FrameGeometry = { frameAspect: 16 / 9, screenW: 900, screenH: 400 };   // top and bottom cropped, the scale is 900 / 1 per frame width
    const f = followCorners(defaultCorners(900, 400), { dx: 0.1, dy: 0 }, wide);
    expect(f.farLeft.x - defaultCorners(900, 400).farLeft.x).toBeCloseTo(90, 6);
  });
});

describe('judgeShift', () => {
  it('leaves the court alone while the camera has hardly moved', () => {
    expect(judgeShift({ dx: 0.002, dy: -0.003, quality: 0.99 }, null)).toEqual({ kind: 'in-place' });
  });
  it('waits for a second reading that agrees before following a small move', () => {
    expect(judgeShift({ dx: 0.02, dy: 0, quality: 0.95 }, null)).toEqual({ kind: 'wait' });
    expect(judgeShift({ dx: 0.02, dy: 0, quality: 0.95 }, { dx: 0.0195, dy: 0.001 })).toEqual({ kind: 'follow', dx: 0.02, dy: 0 });
    expect(judgeShift({ dx: 0.02, dy: 0, quality: 0.95 }, { dx: 0.04, dy: 0 })).toEqual({ kind: 'wait' });   // the readings disagree
  });
  it('does not follow a reading that agrees only so-so with the reference', () => {
    expect(judgeShift({ dx: 0.02, dy: 0, quality: 0.7 }, { dx: 0.02, dy: 0 })).toEqual({ kind: 'wait' });
  });
  it('warns when the camera has moved too far, or the view is not the same', () => {
    expect(judgeShift({ dx: 0.1, dy: 0, quality: 0.95 }, { dx: 0.1, dy: 0 })).toEqual({ kind: 'lost' });
    expect(judgeShift({ dx: 0.0, dy: 0, quality: 0.3 }, null)).toEqual({ kind: 'lost' });
  });
});
