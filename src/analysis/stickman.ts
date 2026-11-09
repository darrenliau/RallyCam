import { BONES, JOINTS, type Joint, type Pose } from './pose';

export interface Line { x1: number; y1: number; x2: number; y2: number }
export interface Stick {
  lines: Line[];
  head: { cx: number; cy: number; r: number } | null;
  /** The joints as dots. */
  dots: { cx: number; cy: number }[];
}

const idx = (j: Joint) => JOINTS.indexOf(j);

/**
 * The lines of a stick figure for a pose, fitted into a `width` x `height` picture with a margin and kept in proportion.
 * Besides the bones it draws the spine (middle of the shoulders to middle of the hips) and a head circle at the nose.
 * Joints not seen are left out with the bones that need them. Null when too little of the body is there.
 */
export function stickFigure(pose: Pose, width: number, height: number, margin = 6): Stick | null {
  // joints in box proportions (box height is 1 unit, so the width is `aspect` units)
  const pts = pose.joints.map((j) => (j ? { x: j.x * pose.aspect, y: j.y } : null));
  const get = (n: Joint) => pts[idx(n)];
  const lines: Line[] = [];
  const add = (a: { x: number; y: number } | null | undefined, b: { x: number; y: number } | null | undefined) => {
    if (a && b) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  for (const [a, b] of BONES) add(get(a), get(b));
  const ls = get('lShoulder'), rs = get('rShoulder'), lh = get('lHip'), rh = get('rHip'), nose = get('nose');
  const mid = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a ?? b ?? null;
  const neck = mid(ls, rs), pelvis = mid(lh, rh);
  add(neck, pelvis);

  const shoulderWidth = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0.15;
  const head = nose ? { cx: nose.x, cy: nose.y, r: Math.max(0.03, shoulderWidth * 0.4) } : null;
  if (head && neck) lines.push({ x1: neck.x, y1: neck.y, x2: head.cx, y2: head.cy });
  if (lines.length < 3) return null;

  const xs = lines.flatMap((l) => [l.x1, l.x2]).concat(head ? [head.cx - head.r, head.cx + head.r] : []);
  const ys = lines.flatMap((l) => [l.y1, l.y2]).concat(head ? [head.cy - head.r, head.cy + head.r] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spanX = Math.max(x1 - x0, 1e-3), spanY = Math.max(y1 - y0, 1e-3);
  const k = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY);
  const ox = (width - spanX * k) / 2 - x0 * k;
  const oy = (height - spanY * k) / 2 - y0 * k;
  const fx = (x: number) => x * k + ox;
  const fy = (y: number) => y * k + oy;
  return {
    lines: lines.map((l) => ({ x1: fx(l.x1), y1: fy(l.y1), x2: fx(l.x2), y2: fy(l.y2) })),
    head: head ? { cx: fx(head.cx), cy: fy(head.cy), r: head.r * k } : null,
    dots: pts.flatMap((p) => (p ? [{ cx: fx(p.x), cy: fy(p.y) }] : [])),
  };
}
