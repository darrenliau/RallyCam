import { describe, expect, it } from 'vitest';
import { CropGuard } from './cropGuard';

const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.5 };   // sides open, nothing on the frame edge
const at = (t: number, x?: number, y?: number) => ({ t, x, y });
const run = (g: CropGuard, from: number, to: number, x?: number, y?: number) => {
  let r = g.wantsFull;
  for (let t = from; t <= to + 1e-9; t += 1 / 60) r = g.push([at(t, x, y)]);
  return r;
};

describe('CropGuard', () => {
  it('stays on the crop while the shuttle is seen, or vanishes in the middle', () => {
    const g = new CropGuard(crop);
    expect(run(g, 0, 0.5, 0.45, 0.3)).toBe(false);
    expect(run(g, 0.5, 2, undefined, undefined)).toBe(false);   // vanished far from any edge: landed or hidden
  });
  it('looks at the whole frame when the shuttle vanishes near an open edge of the crop', () => {
    const g = new CropGuard(crop);
    run(g, 0, 0.3, 0.45, 0.3);
    run(g, 0.3, 0.4, 0.21, 0.3);        // heading out of the left side
    expect(run(g, 0.4, 0.7, undefined, undefined)).toBe(true);
  });
  it('goes back to the crop after the hold once the shuttle is seen inside it', () => {
    const g = new CropGuard(crop);
    run(g, 0, 0.4, 0.21, 0.3);
    expect(run(g, 0.4, 0.8)).toBe(true);
    expect(run(g, 0.8, 1.5, 0.1, 0.3)).toBe(true);     // out of the crop, still in the picture: stay on the whole frame
    expect(run(g, 1.5, 2.6, 0.45, 0.3)).toBe(false);   // back inside, and the hold has passed
  });
  it('goes back to the crop after a quiet second even if the shuttle never returns', () => {
    const g = new CropGuard(crop);
    run(g, 0, 0.4, 0.21, 0.3);
    run(g, 0.4, 2.0);
    expect(run(g, 2.0, 3.6)).toBe(false);
  });
  it('ignores a crop edge that is the frame edge, and does nothing without a crop', () => {
    const g = new CropGuard({ x: 0, y: 0.1, w: 0.5, h: 0.5 });
    run(g, 0, 0.4, 0.01, 0.3);           // left side is the frame edge
    expect(run(g, 0.4, 1, undefined, undefined)).toBe(false);
    expect(new CropGuard(null).push([at(0, 0.5, 0.5), at(1)])).toBe(false);
  });
});
