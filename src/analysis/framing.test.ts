import { describe, expect, it } from 'vitest';
import { anyOutside, clampWindow, Framer, fullWindow, viewToWorld, wantedWindow, WIDE_RATIO, worldToView, DEFAULT_FRAMING } from './framing';

describe('window maths', () => {
  it('maps the full window to itself', () => {
    expect(worldToView({ x: 0.3, y: 0.7 }, fullWindow())).toEqual({ x: 0.3, y: 0.7 });
  });
  it('round-trips a point through a window', () => {
    const win = { cx: 0.4, cy: 0.6, w: 0.5 };
    const back = viewToWorld(worldToView({ x: 0.45, y: 0.55 }, win), win);
    expect(back.x).toBeCloseTo(0.45);
    expect(back.y).toBeCloseTo(0.55);
  });
  it('puts the window edges at 0 and 1', () => {
    const win = { cx: 0.5, cy: 0.5, w: 0.5 };
    expect(worldToView({ x: 0.25, y: 0.25 }, win)).toEqual({ x: 0, y: 0 });
    expect(worldToView({ x: 0.75, y: 0.75 }, win)).toEqual({ x: 1, y: 1 });
  });
  it('keeps a window inside the picture and no tighter than the start view', () => {
    expect(clampWindow({ cx: 0.05, cy: 0.99, w: 0.6 })).toEqual({ cx: 0.3, cy: 0.7, w: 0.6 });
    expect(clampWindow({ cx: 0.5, cy: 0.5, w: 0.1 }).w).toBe(WIDE_RATIO);
    expect(clampWindow({ cx: 0.5, cy: 0.5, w: 3 }).w).toBe(1);
  });
});

describe('wantedWindow', () => {
  it('has nothing to say with nothing tracked', () => {
    expect(wantedWindow([], DEFAULT_FRAMING)).toBeNull();
  });
  it('is the start view for subjects close together', () => {
    expect(wantedWindow([{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }], DEFAULT_FRAMING)!.win.w).toBe(WIDE_RATIO);
  });
  it('widens to hold subjects far apart, with room', () => {
    const w = wantedWindow([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], DEFAULT_FRAMING)!.win;
    expect(w.w).toBeCloseTo(0.6 / 0.76);
    expect(w.cx).toBeCloseTo(0.5);
  });
  it('looks ahead of a moving shuttle', () => {
    const still = wantedWindow([{ x: 0.5, y: 0.5 }, { x: 0.85, y: 0.5 }], DEFAULT_FRAMING)!.win.w;
    const moving = wantedWindow([{ x: 0.5, y: 0.5 }, { x: 0.85, y: 0.5, vx: 0.5, vy: 0 }], DEFAULT_FRAMING)!.win.w;
    expect(moving).toBeGreaterThan(still);
  });
  it('follows the height as well as the width', () => {
    expect(wantedWindow([{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }], DEFAULT_FRAMING)!.win.w).toBe(1);
  });
});

describe('anyOutside', () => {
  it('is true for a subject outside or at the edge, false inside', () => {
    const win = { cx: 0.5, cy: 0.5, w: 0.5 };
    expect(anyOutside([{ x: 0.5, y: 0.5 }], win)).toBe(false);
    expect(anyOutside([{ x: 0.9, y: 0.5 }], win)).toBe(true);
    expect(anyOutside([{ x: 0.749, y: 0.5 }], win)).toBe(true);
  });
});

describe('Framer', () => {
  const run = (f: Framer, from: number, seconds: number, subjects: Parameters<Framer['update']>[1], step = 0.1) => {
    let t = from;
    for (; t < from + seconds; t += step) f.update(t, subjects);
    return t;
  };

  it('starts where it is told', () => {
    expect(new Framer({ cx: 0.5, cy: 0.5, w: 0.5 }).window.w).toBe(0.5);
  });

  it('widens when a player goes to the edge, gradually and without overshooting', () => {
    const f = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    const seen: number[] = [];
    for (let t = 0; t < 6; t += 0.1) seen.push(f.update(t, [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.95 }]).w);
    expect(seen[seen.length - 1]).toBeCloseTo(0.45 / 0.76, 1);   // holds both, with room
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1e-9);          // never narrows while widening
      expect(seen[i] / seen[i - 1]).toBeLessThan(1.1);                      // never jumps
    }
  });

  it('widens faster when a subject is already outside', () => {
    const calm = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    const rush = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    calm.update(0, [{ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.4 }]);
    rush.update(0, [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.95 }]);
    const a = calm.update(0.5, [{ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.3 }]).w;
    const b = rush.update(0.5, [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.95 }]).w;
    expect(b).toBeGreaterThan(a);
  });

  it('tightens only after a pause and then slowly', () => {
    const f = new Framer({ cx: 0.5, cy: 0.5, w: 1 });
    const near = [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }];
    let t = 0;
    for (; t < 1.2; t += 0.1) f.update(t, near);
    expect(f.window.w).toBe(1);                         // still in the dwell
    for (; t < 3; t += 0.1) f.update(t, near);
    expect(f.window.w).toBeLessThan(1);
    expect(f.window.w).toBeGreaterThan(0.85);           // slow: 0.1 octave a second
  });

  it('does not tighten on a small difference', () => {
    const f = new Framer({ cx: 0.5, cy: 0.5, w: 0.6 });
    run(f, 0, 10, [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }]);   // wants 0.4/0.76 = 0.53: within the dead zone of 0.6? no, 12% tighter
    expect(f.window.w).toBeLessThan(0.6);
    const g = new Framer({ cx: 0.5, cy: 0.5, w: 0.55 });
    run(g, 0, 10, [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }]);   // wants 0.526, 4% tighter: left alone
    expect(g.window.w).toBe(0.55);
  });

  it('goes back to the full picture when nothing is tracked', () => {
    const f = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    let t = run(f, 0, 1, [{ x: 0.5, y: 0.5 }]);
    t = run(f, t, 1, []);
    expect(f.window.w).toBe(0.5);                        // held for a moment
    run(f, t, 8, []);
    expect(f.window.w).toBe(1);
  });

  it('follows the players when it can pan, and stays centred when it cannot', () => {
    const free = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    const locked = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 }, { panLocked: true });
    for (const f of [free, locked]) run(f, 0, 5, [{ x: 0.4, y: 0.4 }]);
    expect(free.window.cx).toBeLessThan(0.45);
    expect(locked.window.cx).toBe(0.5);
  });

  it('keeps the subjects in view while it widens for a player running to the back', () => {
    const f = new Framer({ cx: 0.5, cy: 0.5, w: 0.5 });
    let out = 0;
    for (let t = 0; t < 8; t += 0.05) {
      const y = Math.min(0.92, 0.5 + t * 0.12);          // runs toward the camera at 0.12 of the picture a second
      const win = f.update(t, [{ x: 0.5, y, vx: 0, vy: 0.12 }, { x: 0.5, y: 0.4 }]);
      if (t > 0.5 && anyOutside([{ x: 0.5, y }], win, 1)) out++;
    }
    expect(out).toBe(0);
  });
});
