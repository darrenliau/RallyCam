import { describe, expect, it } from 'vitest';
import { consensusCourt, courtDistance, findCourt, type CourtFit, type LumaImage } from './courtLines';
import { courtMap, type Corners } from './court';

const W = 640;
const H = 360;

/** A picture of a court: a dark green floor, white lines about 3 pixels wide, a bright net tape across it and bright ceiling lights, with noise. */
function render(c: Corners, opts: { noise?: number; blockers?: boolean } = {}): LumaImage {
  const data = new Uint8Array(W * H);
  let seed = 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < data.length; i++) data[i] = 78 + Math.floor((rand() - 0.5) * 2 * (opts.noise ?? 5));
  const dot = (x: number, y: number, r: number, v: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.round(x + dx), yy = Math.round(y + dy);
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= r * r + 1) data[yy * W + xx] = v;
    }
  };
  const seg = (x0: number, y0: number, x1: number, y1: number, r: number, v: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 0; k <= n; k++) dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r, v);
  };
  const map = courtMap({ farLeft: { x: c.farLeft.x * W, y: c.farLeft.y * H }, farRight: { x: c.farRight.x * W, y: c.farRight.y * H }, nearRight: { x: c.nearRight.x * W, y: c.nearRight.y * H }, nearLeft: { x: c.nearLeft.x * W, y: c.nearLeft.y * H } });
  const S = 0.46 / 6.1, SH = 1.98 / 13.4, LB = 0.76 / 13.4;
  const lines: [number, number, number, number][] = [[0, 0, 1, 0], [0, 1, 1, 1], [0, 0, 0, 1], [1, 0, 1, 1], [S, 0, S, 1], [1 - S, 0, 1 - S, 1], [0, 0.5 - SH, 1, 0.5 - SH], [0, 0.5 + SH, 1, 0.5 + SH], [0, LB, 1, LB], [0, 1 - LB, 1, 1 - LB], [0.5, 0.5 - SH, 0.5, LB], [0.5, 0.5 + SH, 0.5, 1 - LB]];
  for (const [u0, v0, u1, v1] of lines) { const a = map.toScreen(u0, v0), b = map.toScreen(u1, v1); seg(a.x, a.y, b.x, b.y, 1.5, 235); }
  seg(60, 55, 600, 95, 2, 245);       // a long bright light high in the picture
  seg(0, 128, 640, 126, 1.5, 230);    // net tape across the picture
  if (opts.blockers) for (const [x, y] of [[300, 215], [380, 260], [250, 300]]) for (let dy = -22; dy <= 22; dy++) for (let dx = -9; dx <= 9; dx++) data[Math.round(y + dy) * W + Math.round(x + dx)] = 40; // players
  return { data, width: W, height: H };
}

const truth: Corners = { farLeft: { x: 0.36, y: 0.45 }, farRight: { x: 0.64, y: 0.45 }, nearRight: { x: 0.94, y: 0.9 }, nearLeft: { x: 0.06, y: 0.9 } };

describe('findCourt', () => {
  it('finds a court seen from behind its near end', () => {
    const fit = findCourt(render(truth))!;
    expect(fit).not.toBeNull();
    expect(courtDistance(fit.corners, truth)).toBeLessThan(0.02);
    expect(fit.confidence).toBeGreaterThan(0.7);
  });

  it('is not thrown by players standing on the lines, or by noise', () => {
    const fit = findCourt(render(truth, { noise: 12, blockers: true }))!;
    expect(fit).not.toBeNull();
    expect(courtDistance(fit.corners, truth)).toBeLessThan(0.04);
  });

  it('finds a court when its near corners are outside the picture', () => {
    const wide: Corners = { farLeft: { x: 0.4, y: 0.5 }, farRight: { x: 0.62, y: 0.5 }, nearRight: { x: 1.25, y: 0.97 }, nearLeft: { x: -0.2, y: 0.97 } };
    const fit = findCourt(render(wide))!;
    expect(fit).not.toBeNull();
    expect(courtDistance(fit.corners, wide)).toBeLessThan(0.08);
  });

  it('says nothing for a picture with no court in it', () => {
    const data = new Uint8Array(W * H).fill(90);
    for (let i = 0; i < data.length; i++) data[i] += (i * 7919) % 11;
    expect(findCourt({ data, width: W, height: H })).toBeNull();
  });
});

describe('consensusCourt', () => {
  const fit = (c: Corners, confidence = 0.9): CourtFit => ({ corners: c, confidence });
  const shifted = (dx: number): Corners => ({ farLeft: { x: truth.farLeft.x + dx, y: truth.farLeft.y }, farRight: { x: truth.farRight.x + dx, y: truth.farRight.y }, nearRight: { x: truth.nearRight.x + dx, y: truth.nearRight.y }, nearLeft: { x: truth.nearLeft.x + dx, y: truth.nearLeft.y } });

  it('outvotes a look that is far from the others', () => {
    const r = consensusCourt([fit(truth), fit(shifted(0.005)), fit(shifted(0.4))])!;
    expect(courtDistance(r.corners, truth)).toBeLessThan(0.01);
  });
  it('halves the confidence when there is only one look', () => {
    expect(consensusCourt([fit(truth, 0.8)])!.confidence).toBeCloseTo(0.4, 6);
  });
  it('is less sure when the looks disagree', () => {
    const agree = consensusCourt([fit(truth), fit(shifted(0.003)), fit(shifted(-0.003))])!.confidence;
    const disagree = consensusCourt([fit(truth), fit(shifted(0.2)), fit(shifted(-0.2))])!.confidence;
    expect(disagree).toBeLessThan(agree);
  });
  it('has nothing to say with no looks', () => {
    expect(consensusCourt([])).toBeNull();
  });
});
