import { describe, expect, it } from 'vitest';
import { poseEventToReference, decodePose, hitPose, JOINTS, matchBox, packPose, PoseHistory, poseFeatures, unpackPose, type Pose } from './pose';

/** A standing figure in a unit box; `wristY` is where both wrists are. */
function figure(wristY: number, t = 0): Pose {
  const at: Record<string, [number, number]> = {
    nose: [0.5, 0.08], lShoulder: [0.4, 0.2], rShoulder: [0.6, 0.2], lElbow: [0.35, 0.3], rElbow: [0.65, 0.3],
    lWrist: [0.3, wristY], rWrist: [0.7, wristY], lHip: [0.45, 0.5], rHip: [0.55, 0.5],
    lKnee: [0.45, 0.72], rKnee: [0.55, 0.72], lAnkle: [0.45, 0.95], rAnkle: [0.55, 0.95],
  };
  return { t, aspect: 0.4, joints: JOINTS.map((n) => ({ x: at[n][0], y: at[n][1] })) };
}

describe('poseFeatures', () => {
  it('calls a hand well above the shoulders overhead', () => {
    expect(poseFeatures(figure(-0.05))!.height).toBe('overhead');
  });
  it('calls a hand at the hips low and a hand at the chest the side', () => {
    expect(poseFeatures(figure(0.6))!.height).toBe('low');
    expect(poseFeatures(figure(0.3))!.height).toBe('side');
  });
  it('takes the higher hand as the racket hand', () => {
    const p = figure(0.6);
    p.joints[6] = { x: 0.7, y: -0.1 };
    expect(poseFeatures(p)!.height).toBe('overhead');
  });
  it('gives nothing when the shoulders are not seen', () => {
    const p = figure(0.3);
    p.joints[1] = null;
    expect(poseFeatures(p)).toBeNull();
  });
});

describe('hitPose', () => {
  it('uses the highest hand in the window around the hit', () => {
    const r = hitPose([figure(0.3, 9.7), figure(-0.1, 9.9), figure(0.6, 10.3)], 10);
    expect(r!.height).toBe('overhead');
    expect(r!.dt).toBeCloseTo(-0.1);
  });
  it('ignores poses outside the window', () => {
    expect(hitPose([figure(-0.1, 8)], 10)).toBeNull();
  });
});

describe('decodePose', () => {
  const kp = (c: number) => JOINTS.flatMap((_, i) => [0.2 + i * 0.01, 0.3 + i * 0.02, c]);
  it('turns frame fractions into box fractions', () => {
    const s = decodePose({ t: 1, x: 0.2, y: 0.3, w: 0.1, h: 0.3, kp: kp(0.9) }, 16 / 9)!;
    expect(s.pose.joints[0]!.x).toBeCloseTo(0);
    expect(s.pose.joints[0]!.y).toBeCloseTo(0);
    expect(s.pose.aspect).toBeCloseTo((0.1 * 16 / 9) / 0.3);
  });
  it('rejects a body that was hardly seen', () => {
    expect(decodePose({ t: 1, x: 0.2, y: 0.3, w: 0.1, h: 0.3, kp: kp(0.1) }, 16 / 9)).toBeNull();
  });
});

describe('packing and history', () => {
  it('round-trips a pose to hundredths', () => {
    const p = figure(0.3);
    p.joints[3] = null;
    const back = unpackPose(packPose(p))!;
    expect(back.joints[3]).toBeNull();
    expect(back.joints[0]!.x).toBeCloseTo(0.5, 2);
    expect(back.aspect).toBeCloseTo(0.4, 2);
  });
  it('forgets old poses', () => {
    const h = new PoseHistory(2);
    h.add(1, figure(0.3, 0));
    h.add(1, figure(0.3, 5));
    expect(h.of(1)).toHaveLength(1);
  });
  it('matches a pose to the nearest box', () => {
    const boxes = [{ x: 0.1, y: 0.1, w: 0.1, h: 0.3 }, { x: 0.6, y: 0.1, w: 0.1, h: 0.3 }];
    expect(matchBox({ x: 0.61, y: 0.12, w: 0.1, h: 0.3 }, boxes)).toBe(1);
    expect(matchBox({ x: 0.9, y: 0.5, w: 0.1, h: 0.3 }, boxes)).toBe(-1);
  });
});

describe('poseEventToReference', () => {
  it('leaves an event without zoom alone and shrinks one taken at 2x about the middle', () => {
    const e = { t: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.4, kp: [0.6, 0.7, 0.9] };
    expect(poseEventToReference(e)).toBe(e);
    const r = poseEventToReference({ ...e, z: 2 });
    expect(r.x).toBeCloseTo(0.5);
    expect(r.w).toBeCloseTo(0.1);
    expect(r.kp[0]).toBeCloseTo(0.55);
    expect(r.kp[1]).toBeCloseTo(0.6);
    expect(r.kp[2]).toBe(0.9);
  });
});
