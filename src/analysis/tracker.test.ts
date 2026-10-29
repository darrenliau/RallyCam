import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners } from './court';
import type { Detection, PersonDetector } from './detector';
import type { Track } from './players';
import { DetectorPlayerTracker, footToScreen, PlayerTrackerCore, type FrameGeometry } from './tracker';

const g: FrameGeometry = { frameAspect: 16 / 9, screenW: 800, screenH: 450 };
const map = courtMap(defaultCorners(g.screenW, g.screenH));

/** A detection whose feet stand at court position (u, v). */
function personAt(u: number, v: number, score = 0.9): Detection {
  const foot = map.toScreen(u, v);
  const sc = Math.max(g.screenW / g.frameAspect, g.screenH);
  const ox = (g.screenW - g.frameAspect * sc) / 2;
  const oy = (g.screenH - sc) / 2;
  const fx = (foot.x - ox) / (g.frameAspect * sc);
  const fy = (foot.y - oy) / sc;
  return { x: fx - 0.02, y: fy - 0.2, w: 0.04, h: 0.2, score };
}

const byId = (tracks: Track[]): Record<number, Track> => Object.fromEntries(tracks.map((t) => [t.id, t]));

describe('footToScreen', () => {
  it('is the identity-scaled mapping when the screen has the camera aspect ratio', () => {
    const p = footToScreen({ x: 0.25, y: 0.5, w: 0.1, h: 0.25, score: 1 }, g);
    expect(p.x).toBeCloseTo(0.3 * 800, 6);
    expect(p.y).toBeCloseTo(0.75 * 450, 6);
  });
  it('accounts for the crop on a wider screen', () => {
    const wide = { frameAspect: 16 / 9, screenW: 900, screenH: 400 }; // 2.25 > 1.78, so top and bottom are cropped
    const p = footToScreen({ x: 0.5, y: 0.5, w: 0, h: 0, score: 1 }, wide);
    expect(p.x).toBeCloseTo(450, 6);
    expect(p.y).toBeCloseTo(200, 6); // frame centre stays at the screen centre
  });
});

describe('PlayerTrackerCore', () => {
  it('tracks one player per side in singles and keeps ids stable', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 1 });
    let t = core.update([personAt(0.5, 0.85), personAt(0.5, 0.15)], map, g);
    expect(t.map((x) => x.id).sort()).toEqual([0, 1]);
    expect(byId(t)[0].v).toBeGreaterThan(0.5);
    expect(byId(t)[1].v).toBeLessThan(0.5);
    for (let i = 1; i <= 10; i++) t = core.update([personAt(0.5 + 0.01 * i, 0.85), personAt(0.5 - 0.01 * i, 0.15)], map, g);
    expect(byId(t)[0].u).toBeGreaterThan(0.5);
    expect(byId(t)[1].u).toBeLessThan(0.5);
  });

  it('numbers doubles partners left to right', () => {
    const core = new PlayerTrackerCore({ nNear: 2, nFar: 0 });
    const t = core.update([personAt(0.7, 0.8), personAt(0.3, 0.85)], map, g);
    expect(byId(t)[0].u).toBeLessThan(byId(t)[1].u);
  });

  it('keeps partners apart when they swap sides of the court', () => {
    const core = new PlayerTrackerCore({ nNear: 2, nFar: 0, smoothing: 0.8 });
    let t = core.update([personAt(0.25, 0.9), personAt(0.75, 0.62)], map, g);
    for (let i = 1; i <= 20; i++) {
      t = core.update([personAt(0.25 + 0.025 * i, 0.9), personAt(0.75 - 0.025 * i, 0.62)], map, g);
    }
    expect(byId(t)[0].u).toBeGreaterThan(0.6); // player 0 (back) walked from left to right
    expect(byId(t)[0].v).toBeGreaterThan(0.8);
    expect(byId(t)[1].u).toBeLessThan(0.4);
    expect(byId(t)[1].v).toBeLessThan(0.7);
  });

  it('coasts through missed frames and keeps the same id', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 0 });
    for (let i = 0; i < 5; i++) core.update([personAt(0.4 + 0.02 * i, 0.8)], map, g);
    let t = core.update([], map, g);
    for (let i = 0; i < 4; i++) t = core.update([], map, g);
    expect(t).toHaveLength(1);
    const back = core.update([personAt(0.52, 0.8)], map, g);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(0);
    expect(back[0].u).toBeGreaterThan(0.45);
  });

  it('coasts in the direction of travel when the player moves towards the net', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 0 });
    for (let i = 0; i < 6; i++) core.update([personAt(0.5, 0.9 - 0.02 * i)], map, g);
    const before = core.update([], map, g)[0].v;
    const after = core.update([], map, g)[0].v;
    expect(after).toBeLessThan(before); // still moving up the court, not frozen
  });

  it('drops a player after too many missed frames', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 0, maxLostFrames: 3 });
    core.update([personAt(0.5, 0.8)], map, g);
    let t = core.update([], map, g);
    for (let i = 0; i < 5; i++) t = core.update([], map, g);
    expect(t).toHaveLength(0);
  });

  it('ignores spectators outside the court and extra people beyond the expected count', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 1 });
    const t = core.update([personAt(0.5, 0.85), personAt(0.5, 0.15), personAt(1.8, 0.7), personAt(0.9, 0.9, 0.5)], map, g);
    expect(t).toHaveLength(2);
    // the spectator never becomes a track, even after the real near player briefly leaves
    const t2 = core.update([personAt(0.5, 0.15), personAt(1.8, 0.7)], map, g);
    expect(t2.some((x) => x.u > 1.2)).toBe(false);
  });

  it('ignores low-confidence detections', () => {
    const core = new PlayerTrackerCore({ nNear: 1, nFar: 0 });
    expect(core.update([personAt(0.5, 0.8, 0.1)], map, g)).toHaveLength(0);
  });
});

describe('DetectorPlayerTracker', () => {
  it('reports tracks for every batch of detections the detector sends', () => {
    let push: (d: Detection[]) => void = () => {};
    let stopped = false;
    const detector: PersonDetector = { start: (cb) => { push = cb; }, stop: () => { stopped = true; } };
    const tracker = new DetectorPlayerTracker(detector, () => map, () => g, { nNear: 1, nFar: 1 });
    const seen: number[] = [];
    tracker.start((t) => seen.push(t.length));
    push([personAt(0.5, 0.85)]);
    push([personAt(0.5, 0.85), personAt(0.5, 0.15)]);
    tracker.stop();
    expect(seen).toEqual([1, 2]);
    expect(stopped).toBe(true);
  });
});
