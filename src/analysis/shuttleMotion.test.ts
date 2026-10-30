import { describe, expect, it } from 'vitest';
import { MotionShuttleTracker, playerMask } from './shuttleMotion';

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

  it('ignores a blinking spot that stays in one place', () => {
    const rand = rng(5);
    const tracker = new MotionShuttleTracker();
    let tracked = 0;
    let candidatesLate = 0;
    for (let i = 0; i < 60; i++) {
      const flicker: Blob[] = [{ x: 300 + (i % 3), y: 150 + (i % 2), w: 5, h: 5, value: i % 2 ? 240 : 20 }];
      const r = tracker.update(frame(flicker, rand), W, H, i / 60);
      if (r.track?.confirmed) tracked++;
      if (i > 30) candidatesLate += r.candidates.length;
    }
    expect(candidatesLate).toBe(0);
    expect(tracked).toBe(0);
  });

  it('drops a track that has lasted longer than any flight', () => {
    const rand = rng(6);
    const tracker = new MotionShuttleTracker({ maxTrackAge: 0.3 });
    let sawTrack = false;
    let droppedAfter = false;
    for (let i = 0; i < 40; i++) {
      const r = tracker.update(frame([shuttleAt(i, 10)], rand), W, H, i / 60);
      if (r.track) sawTrack = true;
      else if (sawTrack) droppedAfter = true;
    }
    expect(sawTrack).toBe(true);
    expect(droppedAfter).toBe(true);
  });

  it('does not call the picture shaken when only a player moves, if the player is masked', () => {
    const run = (masked: boolean) => {
      const rand = rng(7);
      const tracker = new MotionShuttleTracker();
      let shaky = 0;
      for (let i = 0; i < 30; i++) {
        const x = 100 + i * 12; // a big player running fast
        const player: Blob = { x, y: 120, w: 60, h: 120, value: i % 2 ? 30 : 200 };
        const masks = masked ? [playerMask({ x, y: 120, w: 60, h: 120 }, { w: W, h: H })] : [];
        if (tracker.update(frame([player], rand), W, H, i / 60, masks).shaky) shaky++;
      }
      return shaky;
    };
    expect(run(false)).toBeGreaterThan(5);
    expect(run(true)).toBe(0);
  });

  it('does not start a track on a racket swinging inside a player\'s box, but still follows a shuttle outside it', () => {
    const rand = rng(8);
    const tracker = new MotionShuttleTracker();
    const body = { x: 280, y: 100, w: 50, h: 110 };
    const mask = playerMask(body, { w: W, h: H });
    let confirmedAtInside = 0;
    for (let i = 0; i < 12; i++) {
      // a small bright racket head sweeping fast beside the body, within the widened box
      const head: Blob = { x: 250 + i * 8, y: 90 + i * 3, w: 4, h: 4, value: 240 };
      const r = tracker.update(frame([head], rand), W, H, i / 60, [mask]);
      if (r.track?.confirmed) confirmedAtInside++;
    }
    expect(confirmedAtInside).toBe(0);
    let tracked = 0;
    for (let i = 12; i < 50; i++) {
      const r = tracker.update(frame([shuttleAt(i - 12, 12)], rand), W, H, i / 60, [mask]);
      if (r.track?.confirmed) tracked++;
    }
    expect(tracked).toBeGreaterThan(10);
  });

  it('widens a player box for the arms and racket, and keeps it inside the picture', () => {
    const m = playerMask({ x: 10, y: 10, w: 40, h: 100 }, { w: 640, h: 360 });
    expect(m.x).toBe(0);
    expect(m.y).toBe(0);
    expect(m.w).toBeGreaterThan(60);
    expect(m.y + m.h).toBeGreaterThan(110);
  });

  it('does not start a track in a crowded frame, but keeps following one already started', () => {
    const noise = rng(21);
    const rand = rng(11);
    // learned background off, so only the crowd rule is tested
    const options = { crowdedCount: 6, activityLimit: 10, hotCount: 99 };
    // 8 specks that jump to new places every frame (a shimmering screen) make every frame crowded
    const specks = (): Blob[] => Array.from({ length: 8 }, () => ({ x: 20 + noise() * 560, y: 20 + noise() * 300, w: 4, h: 4, value: 240 }));
    const crowded = new MotionShuttleTracker(options);
    let tracked = 0;
    for (let i = 0; i < 40; i++) {
      if (crowded.update(frame([...specks(), shuttleAt(i, 12)], rand), W, H, i / 60).track?.confirmed) tracked++;
    }
    expect(tracked).toBe(0);

    const started = new MotionShuttleTracker(options);
    let kept = 0;
    for (let i = 0; i < 40; i++) {
      const blobs = i < 12 ? [shuttleAt(i, 12)] : [...specks(), shuttleAt(i, 12)]; // the crowd arrives after the track exists
      const r = started.update(frame(blobs, rand), W, H, i / 60);
      if (i >= 14 && r.track?.confirmed && r.track.misses === 0) kept++;
    }
    expect(kept).toBeGreaterThan(10);
  });

  it('learns a flickering row of squares and stops treating it as candidates', () => {
    const rand = rng(12);
    const tracker = new MotionShuttleTracker();
    const specks = (i: number): Blob[] => Array.from({ length: 5 }, (_, k) => ({ x: 60 + k * 90, y: 300, w: 5, h: 5, value: i % 2 ? 240 : 20 }));
    let early = 0;
    let late = 0;
    for (let i = 0; i < 160; i++) {
      const r = tracker.update(frame(specks(i), rand), W, H, i / 60);
      if (i < 12) early += r.candidates.length;
      if (i > 120) late += r.candidates.length;
    }
    expect(early).toBeGreaterThan(0);
    expect(late).toBe(0);
  });

  it('still finds a shuttle that crosses the flickering row once the row has been learned', () => {
    const rand = rng(13);
    const tracker = new MotionShuttleTracker();
    const specks = (i: number): Blob[] => Array.from({ length: 5 }, (_, k) => ({ x: 60 + k * 90, y: 300, w: 5, h: 5, value: i % 2 ? 240 : 20 }));
    for (let i = 0; i < 140; i++) tracker.update(frame(specks(i), rand), W, H, i / 60);
    let tracked = 0;
    for (let i = 140; i < 180; i++) {
      const r = tracker.update(frame([...specks(i), shuttleAt(i - 140, 12)], rand), W, H, i / 60);
      if (r.track?.confirmed) tracked++;
    }
    expect(tracked).toBeGreaterThan(5);
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
