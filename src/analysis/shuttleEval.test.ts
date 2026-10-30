import { describe, expect, it } from 'vitest';
import { evaluate, labelledPosition, type FrameResult, type Labels } from './shuttleEval';

const FPS = 60;
/** 3 seconds. The shuttle is in play from 1 s to 2 s, flying right at 300 px/s along y = 400. */
const labels: Labels = {
  fps: FPS,
  playIntervals: [[1, 2]],
  points: [1, 1.25, 1.5, 1.75, 2].map((t) => ({ t, x: 100 + 300 * (t - 1), y: 400 })),
};
const truth = (t: number) => ({ x: 100 + 300 * (t - 1), y: 400 });
const frames = (make: (t: number) => Partial<FrameResult>): FrameResult[] =>
  Array.from({ length: 180 }, (_, i) => ({ t: i / FPS, boxes: [], ...make(i / FPS) }));

describe('labelledPosition', () => {
  it('joins the labels either side, and gives up across a long gap', () => {
    expect(labelledPosition(1.125, labels, 0.3)!.x).toBeCloseTo(137.5, 6);
    expect(labelledPosition(0.5, labels, 0.3)).toBeUndefined();
    expect(labelledPosition(1.125, labels, 0.1)).toBeUndefined();
  });
});

describe('evaluate', () => {
  it('scores a perfect tracker', () => {
    const m = evaluate(frames((t) => (t >= 1 && t <= 2 ? { boxes: [truth(t)], track: truth(t) } : {})), labels);
    expect(m.candidateRecall).toBe(1);
    expect(m.trackRecall).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.falseTracks).toBe(0);
    expect(m.meanError).toBe(0);
  });

  it('counts a track while nothing is in play as false', () => {
    const m = evaluate(frames((t) => (t >= 1 && t <= 2 ? { boxes: [truth(t)], track: truth(t) } : t >= 2.4 && t <= 2.8 ? { track: { x: 50, y: 50 } } : {})), labels);
    expect(m.falseTracks).toBe(1);
    expect(m.falseFrames).toBeGreaterThan(20);
    expect(m.precision).toBeLessThan(0.8);
  });

  it('counts a track in play but far from the shuttle as false', () => {
    const m = evaluate(frames((t) => (t >= 1 && t <= 2 ? { boxes: [truth(t)], track: { x: truth(t).x, y: 600 } } : {})), labels);
    expect(m.trackRecall).toBe(0);
    expect(m.candidateRecall).toBe(1);
    expect(m.falseTracks).toBe(1);
  });

  it('reports a candidate that was there even when the track missed it', () => {
    const m = evaluate(frames((t) => (t >= 1 && t <= 2 ? { boxes: [truth(t)] } : {})), labels);
    expect(m.candidateRecall).toBe(1);
    expect(m.trackRecall).toBe(0);
    expect(m.trackFrames).toBe(0);
  });

  it('measures how far off the track is where it is right', () => {
    const m = evaluate(frames((t) => (t >= 1 && t <= 2 ? { boxes: [truth(t)], track: { x: truth(t).x + 6, y: truth(t).y + 8 } } : {})), labels);
    expect(m.trackRecall).toBe(1);
    expect(m.meanError).toBeCloseTo(10, 6);
  });
});
