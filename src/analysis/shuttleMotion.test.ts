import { describe, expect, it } from 'vitest';
import { MotionShuttleTracker } from './shuttleMotion';

const W = 640;
const H = 360;

/** Small deterministic noise so the tests do not depend on Math.random. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

interface Blob { x: number; y: number; w: number; h: number; value: number }

function frame(blobs: Blob[], rand: () => number, noise = 3): Uint8Array {
  const f = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 90 + (x / W) * 20 + (rand() - 0.5) * 2 * noise;
  for (const b of blobs) {
    for (let y = Math.max(0, Math.round(b.y)); y < Math.min(H, Math.round(b.y + b.h)); y++) {
      for (let x = Math.max(0, Math.round(b.x)); x < Math.min(W, Math.round(b.x + b.w)); x++) f[y * W + x] = b.value;
    }
  }
  return f;
}

/** A shuttle (4x4 bright blob) flying in a shallow arc, `speed` pixels per frame, 60 frames a second. */
const shuttleAt = (i: number, speed: number): Blob => ({ x: 40 + i * speed, y: 200 - Math.sin(i / 14) * 60 - i * 0.5, w: 4, h: 4, value: 235 });

describe('MotionShuttleTracker', () => {
  it('follows a small fast blob and ignores a big slow one', () => {
    const rand = rng(1);
    const tracker = new MotionShuttleTracker();
    let confirmedAt = -1;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const player: Blob = { x: 300 + i * 2, y: 120 + (i % 7), w: 40, h: 90, value: 40 }; // big, moves a little
      const s = shuttleAt(i, 12);
      const r = tracker.update(frame([player, s], rand), W, H, i / 60);
      if (r.track?.confirmed) {
        if (confirmedAt < 0) confirmedAt = i;
        // the track lags one frame: it is where the shuttle was in the previous frame
        const truth = shuttleAt(i - 1, 12);
        worst = Math.max(worst, Math.hypot(r.track.x - (truth.x + 2), r.track.y - (truth.y + 2)));
      }
    }
    expect(confirmedAt).toBeGreaterThan(0);
    expect(confirmedAt).toBeLessThan(8);
    expect(worst).toBeLessThan(8);
  });

  it('keeps the track through a few missed frames', () => {
    const rand = rng(2);
    const tracker = new MotionShuttleTracker();
    let last;
    for (let i = 0; i < 30; i++) {
      const hidden = i >= 18 && i < 21; // the shuttle is hidden for three frames
      last = tracker.update(frame(hidden ? [] : [shuttleAt(i, 10)], rand), W, H, i / 60);
    }
    expect(last?.track?.confirmed).toBe(true);
    expect(last?.track?.misses).toBe(0);
  });

  it('does not invent a track from noise alone', () => {
    const rand = rng(3);
    const tracker = new MotionShuttleTracker();
    let tracks = 0;
    for (let i = 0; i < 80; i++) {
      if (tracker.update(frame([], rand, 4), W, H, i / 60).track) tracks++;
    }
    expect(tracks).toBe(0);
  });

  it('skips frames where the whole picture keeps changing (phone shaken, lights flickering)', () => {
    const rand = rng(4);
    const tracker = new MotionShuttleTracker();
    const normal = () => frame([], rand);
    const bright = () => normal().map((v) => Math.min(255, v + 80));
    tracker.update(normal(), W, H, 0);
    tracker.update(bright(), W, H, 1 / 60);
    const r = tracker.update(normal(), W, H, 2 / 60); // changed in both differences
    expect(r.shaky).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });

  it('is not fooled by one flash of light', () => {
    const rand = rng(6);
    const tracker = new MotionShuttleTracker();
    tracker.update(frame([], rand), W, H, 0);
    tracker.update(frame([], rand), W, H, 1 / 60);
    const r = tracker.update(frame([], rand).map((v) => Math.min(255, v + 80)), W, H, 2 / 60);
    expect(r.shaky).toBe(false);
    expect(r.candidates).toHaveLength(0);
  });

  it('drops the track after too many misses', () => {
    const rand = rng(5);
    const tracker = new MotionShuttleTracker();
    let last;
    for (let i = 0; i < 12; i++) last = tracker.update(frame([shuttleAt(i, 12)], rand), W, H, i / 60);
    expect(last?.track).toBeDefined();
    for (let i = 12; i < 30; i++) last = tracker.update(frame([], rand), W, H, i / 60);
    expect(last?.track).toBeUndefined();
  });
});
