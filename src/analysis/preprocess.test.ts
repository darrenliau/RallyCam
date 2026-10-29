import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners } from './court';
import { cropResizeRgb, decodeDetections, frameToScreen, rgbLayoutFor, roiFromCorners, screenToFrame, shuttleRoiFromCorners } from './preprocess';
import { footToScreen, type FrameGeometry } from './tracker';

const g: FrameGeometry = { frameAspect: 16 / 9, screenW: 900, screenH: 400 };

describe('screenToFrame', () => {
  it('undoes footToScreen', () => {
    const d = { x: 0.3, y: 0.4, w: 0.1, h: 0.2, score: 1 };
    const back = screenToFrame(footToScreen(d, g), g);
    expect(back.x).toBeCloseTo(0.35, 9);
    expect(back.y).toBeCloseTo(0.6, 9);
  });
});

describe('roiFromCorners', () => {
  it('covers the court and stays inside the frame', () => {
    const roi = roiFromCorners(defaultCorners(900, 400), g);
    expect(roi.x).toBeGreaterThanOrEqual(0);
    expect(roi.y).toBeGreaterThanOrEqual(0);
    expect(roi.x + roi.w).toBeLessThanOrEqual(1);
    expect(roi.y + roi.h).toBeLessThanOrEqual(1);
    const c = defaultCorners(900, 400);
    const far = screenToFrame(c.farLeft, g);
    const near = screenToFrame(c.nearRight, g);
    expect(roi.x).toBeLessThan(far.x);
    expect(roi.y).toBeLessThan(far.y); // headroom above the far line
    expect(roi.x + roi.w).toBeGreaterThan(near.x);
  });
});

describe('rgbLayoutFor', () => {
  it('knows the byte order of the formats vision-camera delivers', () => {
    expect(rgbLayoutFor('rgb-bgra-8-bit', 100, 400)).toEqual({ bytesPerPixel: 4, r: 2, g: 1, b: 0 });
    expect(rgbLayoutFor('rgb-rgba-8-bit', 100, 400)).toEqual({ bytesPerPixel: 4, r: 0, g: 1, b: 2 });
    expect(rgbLayoutFor('rgb-rgb-8-bit', 100, 300)?.bytesPerPixel).toBe(3);
    expect(rgbLayoutFor('yuv-420-8-bit-full', 100, 100)).toBeNull();
  });
});

describe('cropResizeRgb', () => {
  // 4x2 BGRA frame with row padding: pixel (x, y) has blue = x*10, green = y*10, red = 200
  const W = 4, H = 2, stride = 20;
  const src = new Uint8Array(stride * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * stride + x * 4;
    src[i] = x * 10; src[i + 1] = y * 10; src[i + 2] = 200; src[i + 3] = 255;
  }
  const bgra = rgbLayoutFor('rgb-bgra-8-bit', W, stride)!;

  it('copies the whole frame 1:1 and reorders BGRA to RGB, ignoring row padding', () => {
    const out = cropResizeRgb(src, W, H, stride, bgra, { x: 0, y: 0, w: 1, h: 1 }, 4, 2);
    expect(Array.from(out.slice(0, 3))).toEqual([200, 0, 0]); // pixel (0,0): r, g, b
    expect(Array.from(out.slice(3 * 3, 3 * 3 + 3))).toEqual([200, 0, 30]); // pixel (3,0)
    expect(Array.from(out.slice(4 * 3, 4 * 3 + 3))).toEqual([200, 10, 0]); // pixel (0,1)
  });

  it('crops a region and scales it up', () => {
    const out = cropResizeRgb(src, W, H, stride, bgra, { x: 0.5, y: 0, w: 0.5, h: 1 }, 4, 2); // right half
    expect(out[2]).toBe(20); // blue of the first output pixel comes from source x=2
    expect(out[3 * 3 + 2]).toBe(30); // last output pixel from source x=3
  });
});

describe('decodeDetections', () => {
  it('keeps people above the threshold and maps boxes into the whole frame', () => {
    const boxes = new Float32Array([0.2, 0.1, 0.8, 0.3, /**/ 0.0, 0.0, 1, 1, /**/ 0, 0, 0.5, 0.5]);
    const classes = new Float32Array([0, 17, 0]);
    const scores = new Float32Array([0.9, 0.95, 0.2]);
    const roi = { x: 0.2, y: 0.1, w: 0.5, h: 0.6 };
    const d = decodeDetections(boxes, classes, scores, 3, roi, 0.4);
    expect(d).toHaveLength(1); // the dog and the low-score person are dropped
    expect(d[0].x).toBeCloseTo(0.2 + 0.1 * 0.5, 6);
    expect(d[0].y).toBeCloseTo(0.1 + 0.2 * 0.6, 6);
    expect(d[0].w).toBeCloseTo(0.2 * 0.5, 6);
    expect(d[0].h).toBeCloseTo(0.6 * 0.6, 6);
  });

  it('feeds the tracker: a decoded person lands where the court mapping expects', () => {
    const g2: FrameGeometry = { frameAspect: 16 / 9, screenW: 1600, screenH: 900 };
    const map = courtMap(defaultCorners(1600, 900));
    const foot = map.toScreen(0.5, 0.8);
    const f = screenToFrame(foot, g2);
    const roi = { x: 0.1, y: 0.2, w: 0.8, h: 0.75 };
    // a box whose bottom-centre is the foot, written in ROI coordinates
    const bx = (f.x - roi.x) / roi.w, by = (f.y - roi.y) / roi.h;
    const d = decodeDetections(new Float32Array([by - 0.2, bx - 0.02, by, bx + 0.02]), new Float32Array([0]), new Float32Array([0.9]), 1, roi, 0.4);
    const back = map.toCourt(footToScreen(d[0], g2));
    expect(back.u).toBeCloseTo(0.5, 6);
    expect(back.v).toBeCloseTo(0.8, 6);
  });
});

describe('frameToScreen and the shuttle area', () => {
  it('is the inverse of screenToFrame', () => {
    const p = frameToScreen(screenToFrame({ x: 123, y: 77 }, g), g);
    expect(p.x).toBeCloseTo(123, 6);
    expect(p.y).toBeCloseTo(77, 6);
  });
  it('watches more of the space above the court than the player area does', () => {
    const c = defaultCorners(900, 400);
    const players = roiFromCorners(c, g);
    const shuttle = shuttleRoiFromCorners(c, g);
    expect(shuttle.y).toBeLessThanOrEqual(players.y);
    expect(shuttle.y + shuttle.h).toBeLessThanOrEqual(1);
    expect(shuttle.h).toBeGreaterThan(players.h * 0.8);
  });
});
