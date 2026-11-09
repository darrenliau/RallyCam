import { describe, expect, it } from 'vitest';
import { reference, shiftFrom } from './cameraShift';
import type { LumaImage } from './courtLines';

const W = 640, H = 360;
let seed = 11;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/** A fixed scene (blocks of different brightness, with lines), drawn with its origin moved by (ox, oy) pixels, and people-sized blobs. */
function scene(ox: number, oy: number, people: { x: number; y: number }[] = []): LumaImage {
  const data = new Uint8Array(W * H);
  const base = (x: number, y: number) => {
    const X = x - ox, Y = y - oy;
    let v = 70 + ((Math.floor(X / 37) * 53 + Math.floor(Y / 29) * 97) % 90);
    if (Math.abs(((X * 3 + Y * 5) % 211) - 100) < 2) v = 250;            // slanted lines
    if (Math.abs((Y % 120) - 60) < 2) v = 240;                            // a level line
    return v;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = base(x, y);
  for (const p of people) for (let y = p.y; y < p.y + 90 && y < H; y++) for (let x = p.x; x < p.x + 30 && x < W; x++) data[y * W + x] = 20 + ((x * 7 + y * 3) % 60);
  return { data, width: W, height: H };
}

describe('shiftFrom', () => {
  const ref = reference(scene(0, 0));
  it('finds no shift in the same view', () => {
    const s = shiftFrom(ref, scene(0, 0));
    expect(Math.abs(s.dx)).toBeLessThan(0.002);
    expect(Math.abs(s.dy)).toBeLessThan(0.002);
    expect(s.quality).toBeGreaterThan(0.9);
  });
  it('finds a small pan or tilt, in the right direction', () => {
    const right = shiftFrom(ref, scene(16, 0));          // 16 of 640 pixels = 2.5% of the width
    expect(right.dx).toBeGreaterThan(0.018);
    expect(right.dx).toBeLessThan(0.032);
    expect(Math.abs(right.dy)).toBeLessThan(0.006);
    const down = shiftFrom(ref, scene(0, 9));            // 9 of 360 = 2.5% of the height
    expect(down.dy).toBeGreaterThan(0.018);
    expect(down.dy).toBeLessThan(0.032);
    const left = shiftFrom(ref, scene(-12, 0));
    expect(left.dx).toBeLessThan(-0.012);
  });
  it('is not thrown by people walking about', () => {
    const s = shiftFrom(ref, scene(0, 0, [{ x: 200, y: 150 }, { x: 420, y: 120 }, { x: 80, y: 200 }]));
    expect(Math.abs(s.dx)).toBeLessThan(0.004);
    expect(Math.abs(s.dy)).toBeLessThan(0.004);
    const moved = shiftFrom(ref, scene(12, 6, [{ x: 200, y: 150 }, { x: 420, y: 120 }]));
    expect(moved.dx).toBeGreaterThan(0.012);
    expect(moved.dy).toBeGreaterThan(0.008);
  });
  it('says the views do not match when they are different pictures', () => {
    const other = scene(0, 0);
    for (let i = 0; i < other.data.length; i++) other.data[i] = Math.floor(rand() * 255);
    expect(shiftFrom(ref, other).quality).toBeLessThan(0.5);
  });
});
