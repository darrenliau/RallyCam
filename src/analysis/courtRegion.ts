import type { Corners, Pt } from './court';

/** How far above the court the shuttle is followed, as a share of the court's height in the picture. */
const RAISE = 0.9;
/** How far beyond the side lines, as a share of the court's width in the picture. */
const SIDE = 0.06;

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain), counter-clockwise in a y-down picture. */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const build = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...build(p), ...build([...p].reverse())];
}

/**
 * The part of the picture where a shuttle belongs to the court being filmed: the court itself, a little beyond its side lines,
 * and the air above it. A shuttle anywhere else is on another court or is a light, and is ignored.
 * Corners and positions are fractions of the camera frame.
 */
export function courtRegion(c: Corners): (x: number, y: number) => boolean {
  const pts = [c.farLeft, c.farRight, c.nearRight, c.nearLeft];
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  const h = Math.max(...ys) - Math.min(...ys);
  const w = Math.max(...xs) - Math.min(...xs);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const wide = pts.map((p) => ({ x: p.x + (p.x < midX ? -SIDE : SIDE) * w, y: p.y }));
  const poly = hull([...wide, ...wide.map((p) => ({ x: p.x, y: p.y - RAISE * h }))]);
  return (x, y) => {
    for (let i = 0; i < poly.length; i++) {
      if (cross(poly[i], poly[(i + 1) % poly.length], { x, y }) < 0) return false;
    }
    return true;
  };
}
