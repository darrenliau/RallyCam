import { describe, expect, it } from 'vitest';
import { courtMap, type Corners } from './court';
import { cornersFromMatches, matchLines, refitFromLines, TEMPLATE, type PictureLine } from './courtFit';

const W = 640;
const H = 360;
/** A court seen from behind its near end, low and a little to the side: the near-left corner is far outside the picture. */
const truth: Corners = { farLeft: { x: 218, y: 198 }, farRight: { x: 322, y: 193 }, nearRight: { x: 556, y: 245 }, nearLeft: { x: -270, y: 340 } };

/** The picture lines of a court placed at `c`: each court line as the line through two of its points. */
function linesOf(c: Corners, jitterDeg = 0): PictureLine[] {
  const map = courtMap(c);
  let seed = 3;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
  return TEMPLATE.map((t) => {
    const mid = map.toScreen((t.from[0] + t.to[0]) / 2, (t.from[1] + t.to[1]) / 2);
    const a = map.toScreen(t.from[0], t.from[1]), b = map.toScreen(t.to[0], t.to[1]);
    const dir = Math.atan2(b.y - a.y, b.x - a.x) + (rand() * 2 * jitterDeg * Math.PI) / 180;
    const nx = Math.sin(dir), ny = -Math.cos(dir);
    const angle = (Math.atan2(Math.abs(ny), Math.abs(nx)) * 180) / Math.PI;
    return { a: nx, b: ny, c: -(nx * mid.x + ny * mid.y), angle: 90 - angle, votes: 100 };
  });
}

const dist = (a: Corners, b: Corners) => Math.max(...(['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const).map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)));

describe('refitFromLines', () => {
  it('finds all the lines of a court from where it was nearly placed', () => {
    const near: Corners = { ...truth, farLeft: { x: 224, y: 201 }, nearRight: { x: 550, y: 248 } };
    expect(matchLines(near, linesOf(truth), W, H, 6).length).toBeGreaterThanOrEqual(8);
  });
  it('recovers the corners, including the one far outside the picture, from exact lines', () => {
    // where the nudging of the first guess leaves it: close on the picture's lines, less sure outside
    const start: Corners = { farLeft: { x: 221, y: 200 }, farRight: { x: 319, y: 194 }, nearRight: { x: 552, y: 247 }, nearLeft: { x: -240, y: 336 } };
    const fit = refitFromLines(start, linesOf(truth), W, H);
    expect(dist(fit, truth)).toBeLessThan(1);
  });
  it('keeps the far corner steady when the lines are a little off (the corner hangs on many lines, not four)', () => {
    const start: Corners = { farLeft: { x: 226, y: 202 }, farRight: { x: 316, y: 196 }, nearRight: { x: 549, y: 249 }, nearLeft: { x: -190, y: 330 } };
    const fit = refitFromLines(start, linesOf(truth, 0.4), W, H);
    // a turn of 0.4 degrees in the lines may move the corner outside the picture, but not by a picture's width
    expect(Math.hypot(fit.nearLeft.x - truth.nearLeft.x, fit.nearLeft.y - truth.nearLeft.y)).toBeLessThan(150);
    expect(Math.hypot(fit.nearRight.x - truth.nearRight.x, fit.nearRight.y - truth.nearRight.y)).toBeLessThan(6);
  });
  it('gives the corners back unchanged when too few lines are found', () => {
    const start: Corners = { ...truth };
    expect(refitFromLines(start, linesOf(truth).slice(0, 3), W, H)).toEqual(start);
    expect(cornersFromMatches([])).toBeNull();
  });
});
