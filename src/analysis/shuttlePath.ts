/**
 * Does a run of positions look like a flying shuttle? A shuttle follows a smooth curve (gravity and drag), while noise,
 * a flickering light or a swinging limb jumps about. These helpers fit a smooth curve and report how well the positions fit.
 * Times are seconds, positions are pixels (or any one unit).
 */

export interface PathPoint { t: number; x: number; y: number }

export interface PathFit {
  /** Root mean square distance of the points from the fitted curve, in the unit of the positions. */
  rms: number;
  /** The largest distance of any point from the curve. */
  worst: number;
  /** Position at time `t` according to the fitted curve. */
  at(t: number): { x: number; y: number };
}

/** Least squares quadratic a + b*u + c*u^2 through (u, v) pairs, by solving the 3x3 normal equations. */
function quadratic(u: number[], v: number[]): [number, number, number] {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < u.length; i++) {
    const x = u[i], y = v[i], x2 = x * x;
    s0 += 1; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += y; t1 += x * y; t2 += x2 * y;
  }
  // Cramer's rule on [[s0 s1 s2][s1 s2 s3][s2 s3 s4]] * [a b c] = [t0 t1 t2]
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const m = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const d = det(m);
  if (Math.abs(d) < 1e-12) return [t0 / s0, 0, 0]; // all at one time: fall back to the mean
  const col = (k: number) => m.map((row, r) => row.map((val, c) => (c === k ? [t0, t1, t2][r] : val)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/**
 * Fits x(t) and y(t) as quadratics (a parabola in the picture, which covers the arc of a clear and the straight line of a smash).
 * Needs at least 4 points; returns null otherwise.
 */
export function fitPath(points: PathPoint[]): PathFit | null {
  if (points.length < 4) return null;
  const t0 = points[0].t;
  const u = points.map((p) => p.t - t0);
  const [ax, bx, cx] = quadratic(u, points.map((p) => p.x));
  const [ay, by, cy] = quadratic(u, points.map((p) => p.y));
  const at = (t: number) => {
    const w = t - t0;
    return { x: ax + bx * w + cx * w * w, y: ay + by * w + cy * w * w };
  };
  let sum = 0;
  let worst = 0;
  for (const p of points) {
    const q = at(p.t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    sum += d * d;
    worst = Math.max(worst, d);
  }
  return { rms: Math.sqrt(sum / points.length), worst, at };
}

/**
 * True when the positions are a believable flight: they fit a smooth curve to within a little more than the size of the
 * measurement noise, relative to how far the shuttle moves between samples. A noise track that hops between unrelated
 * specks fails this even when each hop looks plausible on its own.
 */
export function looksLikeFlight(points: PathPoint[], opts: { slack?: number; noise?: number } = {}): boolean {
  const fit = fitPath(points);
  if (!fit) return true; // too short to judge
  const noise = opts.noise ?? 3;          // pixels of position noise to allow for
  const slack = opts.slack ?? 0.2;        // and this share of the typical step between samples
  let steps = 0;
  for (let i = 1; i < points.length; i++) steps += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const meanStep = steps / (points.length - 1);
  return fit.rms <= noise + slack * meanStep;
}

/**
 * Fills the gaps in a flight. For every gap between two samples longer than `maxStep` seconds (but shorter than `maxGap`),
 * adds samples along the fitted curve every `maxStep` seconds. Used after the game, when the whole path is known.
 */
export function bridgeGaps(points: PathPoint[], maxStep: number, maxGap: number): PathPoint[] {
  const fit = fitPath(points);
  if (!fit || points.length < 2) return points;
  const out: PathPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].t - points[i - 1].t;
    if (gap > maxStep * 1.5 && gap <= maxGap) {
      for (let t = points[i - 1].t + maxStep; t < points[i].t - maxStep / 2; t += maxStep) {
        const q = fit.at(t);
        out.push({ t, x: q.x, y: q.y });
      }
    }
    out.push(points[i]);
  }
  return out;
}
