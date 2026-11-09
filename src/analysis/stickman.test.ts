import { describe, expect, it } from 'vitest';
import { JOINTS, type Pose } from './pose';
import { stickFigure } from './stickman';

const pose = (overrides: Partial<Record<(typeof JOINTS)[number], { x: number; y: number } | null>> = {}): Pose => {
  const at: Record<string, { x: number; y: number }> = {
    nose: { x: 0.5, y: 0.08 }, lShoulder: { x: 0.4, y: 0.2 }, rShoulder: { x: 0.6, y: 0.2 }, lElbow: { x: 0.35, y: 0.3 }, rElbow: { x: 0.65, y: 0.3 },
    lWrist: { x: 0.3, y: 0.4 }, rWrist: { x: 0.7, y: 0.4 }, lHip: { x: 0.45, y: 0.5 }, rHip: { x: 0.55, y: 0.5 },
    lKnee: { x: 0.45, y: 0.72 }, rKnee: { x: 0.55, y: 0.72 }, lAnkle: { x: 0.45, y: 0.95 }, rAnkle: { x: 0.55, y: 0.95 },
  };
  return { t: 0, aspect: 0.4, joints: JOINTS.map((n) => (n in overrides ? overrides[n]! : at[n])) };
};

describe('stickFigure', () => {
  it('draws a head, a spine and the limbs inside the picture', () => {
    const s = stickFigure(pose(), 100, 160)!;
    expect(s.head).not.toBeNull();
    expect(s.lines.length).toBeGreaterThanOrEqual(12);
    for (const l of s.lines) for (const v of [l.x1, l.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    for (const l of s.lines) for (const v of [l.y1, l.y2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(160); }
  });
  it('keeps the proportions: the figure is taller than wide', () => {
    const s = stickFigure(pose(), 200, 200)!;
    const xs = s.lines.flatMap((l) => [l.x1, l.x2]);
    const ys = s.lines.flatMap((l) => [l.y1, l.y2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });
  it('leaves out bones with a joint not seen', () => {
    const full = stickFigure(pose(), 100, 160)!.lines.length;
    const part = stickFigure(pose({ lWrist: null, lElbow: null }), 100, 160)!.lines.length;
    expect(part).toBe(full - 2);
  });
  it('gives nothing when there is hardly a body', () => {
    const p = pose();
    p.joints = p.joints.map((j, i) => (i < 2 ? j : null));
    expect(stickFigure(p, 100, 160)).toBeNull();
  });
});
