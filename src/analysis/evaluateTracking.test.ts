import { describe, expect, it } from 'vitest';
import { courtMap, type Corners } from './court';
import { evaluateTracking, formatReport, parseCourtJson, parseDetectionsCsv, parseGroundTruthCsv, type DetectionRow, type Meta } from './evaluateTracking';

// A 1920x1080 camera behind the near baseline; corners in video pixels.
const corners: Corners = parseCourtJson({
  far_left: [700, 300], far_right: [1220, 300], near_right: [1700, 1000], near_left: [220, 1000],
});
const map = courtMap(corners);
const meta: Meta = { width: 1920, height: 1080, fps: 30, totalFrames: 300, frameStep: 1 };

const person = (frame: number, u: number, v: number): DetectionRow => {
  const f = map.toScreen(u, v);
  return { frame, det: { x: f.x / 1920 - 0.01, y: f.y / 1080 - 0.12, w: 0.02, h: 0.12, score: 0.9 } };
};

describe('evaluateTracking', () => {
  it('scores a clean singles rally as fully tracked with no jumps', () => {
    const rows: DetectionRow[] = [];
    for (let f = 0; f < 300; f++) rows.push(person(f, 0.5 + 0.2 * Math.sin(f / 30), 0.85), person(f, 0.5 - 0.2 * Math.sin(f / 30), 0.15));
    const { result, tracksCsv } = evaluateTracking(rows, meta, corners, { nNear: 1, nFar: 1 });
    expect(result.allPlayersSeen).toBeGreaterThan(0.95);
    expect(result.jumps).toBe(0);
    expect(result.perPlayer[0].metres).toBeGreaterThan(5);
    expect(tracksCsv.split('\n')[0]).toBe('frame,id,u,v,lost');
    expect(formatReport(result)).toContain('all players seen');
  });

  it('reports lower coverage when a player is missed for a stretch', () => {
    const rows: DetectionRow[] = [];
    for (let f = 0; f < 300; f++) {
      rows.push(person(f, 0.5, 0.85));
      if (f < 100 || f > 200) rows.push(person(f, 0.5, 0.15)); // far player missing for 100 frames
    }
    const { result } = evaluateTracking(rows, meta, corners, { nNear: 1, nFar: 1 });
    expect(result.allPlayersSeen).toBeLessThan(0.75);
    expect(result.perPlayer[1].longestGapSeconds).toBeGreaterThan(2);
    expect(result.perPlayer[0].seen).toBeGreaterThan(0.95);
  });

  it('can analyse fewer frames per second, like the phone would', () => {
    const rows: DetectionRow[] = [];
    for (let f = 0; f < 300; f++) rows.push(person(f, 0.5, 0.85));
    const full = evaluateTracking(rows, meta, corners, { nNear: 1, nFar: 0 }).result;
    const slow = evaluateTracking(rows, meta, corners, { nNear: 1, nFar: 0, analysisFps: 10 }).result;
    expect(slow.framesAnalysed).toBeLessThan(full.framesAnalysed / 2);
  });

  it('measures foot position error against hand labels', () => {
    const rows: DetectionRow[] = [];
    for (let f = 0; f < 60; f++) rows.push(person(f, 0.5, 0.85));
    const feet = map.toScreen(0.5, 0.85);
    const gt = parseGroundTruthCsv(`frame,id,x,y\n30,0,${feet.x},${feet.y}\n40,0,${feet.x},${feet.y}`);
    const { result } = evaluateTracking(rows, { ...meta, totalFrames: 60 }, corners, { nNear: 1, nFar: 0 }, gt);
    expect(result.groundTruth?.missed).toBe(0);
    expect(result.groundTruth?.medianErrorCm).toBeLessThan(30);
    expect(result.groundTruth?.idCorrect).toBe(1);
  });

  it('parses the detections csv and rejects a court file with a missing corner', () => {
    const rows = parseDetectionsCsv('frame,time_s,x,y,w,h,score\n0,0,0.1,0.2,0.03,0.1,0.8\n');
    expect(rows[0].det.score).toBe(0.8);
    expect(() => parseCourtJson({ near_left: [0, 0] } as never)).toThrow(/far_right|near_right|far_left/);
  });
});
