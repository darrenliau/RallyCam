/**
 * Body pose: where a person's joints are, from the camera's body-pose finder (Apple Vision, in CaptureController.swift).
 * Used to tell how a shot was hit (above the head, at the side, low) and to draw a stick figure for it.
 */

/** The joints we keep, in this order. */
export const JOINTS = [
  'nose', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist',
  'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle',
] as const;
export type Joint = (typeof JOINTS)[number];
const J = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<Joint, number>;

/** Lines of a stick figure, as pairs of joint indexes. The neck and the middle of the hips are drawn from the means of the pairs. */
export const BONES: [Joint, Joint][] = [
  ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
  ['lShoulder', 'rShoulder'], ['lHip', 'rHip'],
];

export interface JointPoint { x: number; y: number }

/**
 * One body at one moment. `joints` is in the order of JOINTS, each as a fraction of the person's box (x across, y down, 0..1),
 * or null when the joint was not seen well. `aspect` is the box's width over its height in pixels, so a figure can be drawn
 * without being stretched.
 */
export interface Pose {
  t: number;
  aspect: number;
  joints: (JointPoint | null)[];
}

/** A pose together with where its person was in the frame (fractions of the frame, top left origin), for matching it to a player. */
export interface PoseSample {
  pose: Pose;
  box: { x: number; y: number; w: number; h: number };
}

/** What the native side sends for one person: the box, and 13 joints as x, y, confidence in fractions of the frame. */
export interface PoseEvent {
  /** The zoom factor of the frame (lens zoom mode); the numbers below are in the zoomed picture. */
  z?: number;
  t: number;
  x: number; y: number; w: number; h: number;
  kp: number[];
}

/** A pose event in the full picture, from one taken in a zoomed picture (lens zoom mode). */
export function poseEventToReference(e: PoseEvent): PoseEvent {
  if (!e.z || e.z <= 1.001) return e;
  const k = 1 / e.z;
  const at = (v: number) => 0.5 + (v - 0.5) * k;
  const kp = e.kp.map((v, i) => (i % 3 === 2 ? v : at(v)));
  return { ...e, x: at(e.x), y: at(e.y), w: e.w * k, h: e.h * k, kp };
}

/** Joints below this confidence are treated as not seen. */
const MIN_CONFIDENCE = 0.25;

/** Turns what the camera sends into a PoseSample, or null when too little of the body was seen to be of use. */
export function decodePose(e: PoseEvent, frameAspect: number): PoseSample | null {
  if (!(e.w > 0 && e.h > 0) || !Array.isArray(e.kp) || e.kp.length < JOINTS.length * 3) return null;
  const joints: (JointPoint | null)[] = [];
  let seen = 0;
  for (let i = 0; i < JOINTS.length; i++) {
    const x = e.kp[i * 3], y = e.kp[i * 3 + 1], c = e.kp[i * 3 + 2];
    if (!(c >= MIN_CONFIDENCE) || !Number.isFinite(x) || !Number.isFinite(y)) { joints.push(null); continue; }
    joints.push({ x: (x - e.x) / e.w, y: (y - e.y) / e.h });
    seen++;
  }
  // the shoulders and at least one wrist are what a shot is judged by
  if (seen < 6 || !joints[J.lShoulder] || !joints[J.rShoulder]) return null;
  return { pose: { t: e.t, aspect: (e.w * frameAspect) / e.h, joints }, box: { x: e.x, y: e.y, w: e.w, h: e.h } };
}

export type HitHeight = 'overhead' | 'side' | 'low';

export interface PoseFeatures {
  /** How far the higher wrist is above the shoulders, in torso lengths (shoulders to hips). Negative: below them. */
  lift: number;
  /** How far the arm is stretched, wrist to shoulder, in torso lengths. */
  reach: number;
  height: HitHeight;
}

const mid = (a: JointPoint, b: JointPoint): JointPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Above the shoulders by this much (torso lengths) is a hit above the head. */
export const OVERHEAD_LIFT = 0.35;
/** Below the shoulders by this much is a low hit (underarm, a lift or a net shot). */
export const LOW_LIFT = -0.7;

/** How the arm that is doing the hitting is held. The higher wrist is taken as the racket hand. Null when the torso or wrists are not seen. */
export function poseFeatures(p: Pose): PoseFeatures | null {
  const j = p.joints;
  const ls = j[J.lShoulder], rs = j[J.rShoulder], lh = j[J.lHip], rh = j[J.rHip];
  if (!ls || !rs) return null;
  const shoulders = mid(ls, rs);
  // torso length in the picture; when the hips are not seen, a body is about 3 torsos tall
  const torso = lh && rh ? mid(lh, rh).y - shoulders.y : NaN;
  const length = torso > 0.05 ? torso : 0.3;
  const wrists = [[j[J.lWrist], ls], [j[J.rWrist], rs]] as const;
  let best: PoseFeatures | null = null;
  for (const [w, s] of wrists) {
    if (!w) continue;
    const lift = (shoulders.y - w.y) / length;
    const reach = Math.hypot((w.x - s.x) * p.aspect, w.y - s.y) / length;
    if (!best || lift > best.lift) best = { lift, reach, height: lift >= OVERHEAD_LIFT ? 'overhead' : lift <= LOW_LIFT ? 'low' : 'side' };
  }
  return best;
}

/** How a shot was hit, from the poses of the player around the moment of the hit. */
export interface HitPose {
  height: HitHeight;
  lift: number;
  /** The pose the figure is drawn from. */
  pose: Pose;
  /** Seconds between that pose and the hit. */
  dt: number;
}

/**
 * Looks at the poses of one player from a moment before the hit to a moment after it and picks how the shot was hit. A swing is fast
 * and poses arrive a few times a second, so the contact itself is usually missed: the highest the hand got in the window is taken
 * (a smash has the hand above the head just before and at contact), and low only when the hand was low throughout.
 */
export function hitPose(samples: Pose[], hitT: number, before = 0.35, after = 0.2): HitPose | null {
  let best: HitPose | null = null;
  for (const pose of samples) {
    const dt = pose.t - hitT;
    if (dt < -before || dt > after) continue;
    const f = poseFeatures(pose);
    if (!f) continue;
    // the highest hand wins; of equals the pose nearer the hit
    if (!best || f.lift > best.lift + 0.05 || (Math.abs(f.lift - best.lift) <= 0.05 && Math.abs(dt) < Math.abs(best.dt))) {
      best = { height: f.height, lift: f.lift, pose, dt };
    }
  }
  return best;
}

/**
 * Poses of each person, newest last, for the last couple of seconds. A pose belongs to the track whose spot in the frame it overlaps most,
 * and the caller says where each track's box is (`boxes`).
 */
export class PoseHistory {
  private byTrack = new Map<number, Pose[]>();
  constructor(private keepS = 2.5) {}

  add(trackId: number, pose: Pose) {
    const list = this.byTrack.get(trackId) ?? [];
    list.push(pose);
    while (list.length && pose.t - list[0].t > this.keepS) list.shift();
    this.byTrack.set(trackId, list);
  }

  of(trackId: number): Pose[] {
    return this.byTrack.get(trackId) ?? [];
  }

  clear() {
    this.byTrack.clear();
  }
}

/** Which of the boxes a pose's person is: the one whose middle is nearest, within half a box width. Returns an index or -1. */
export function matchBox(box: PoseSample['box'], candidates: { x: number; y: number; w: number; h: number }[]): number {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let best = -1, bestD = Infinity;
  candidates.forEach((c, i) => {
    const d = Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy);
    if (d < bestD && d <= Math.max(box.w, c.w) * 0.75) { bestD = d; best = i; }
  });
  return best;
}

/** Compact form for saving: the aspect, then x and y of each joint in hundredths, -1 for a joint not seen. */
export function packPose(p: Pose): number[] {
  const out = [Math.round(p.aspect * 100)];
  for (const j of p.joints) out.push(j ? Math.round(j.x * 100) : -1, j ? Math.round(j.y * 100) : -1);
  return out;
}

export function unpackPose(a: number[], t = 0): Pose | null {
  if (!Array.isArray(a) || a.length !== 1 + JOINTS.length * 2) return null;
  const joints: (JointPoint | null)[] = [];
  for (let i = 0; i < JOINTS.length; i++) {
    const x = a[1 + i * 2], y = a[2 + i * 2];
    joints.push(x < 0 || y < 0 ? null : { x: x / 100, y: y / 100 });
  }
  return { t, aspect: a[0] / 100, joints };
}
