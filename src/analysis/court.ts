export interface Pt { x: number; y: number }
export interface Corners { farLeft: Pt; farRight: Pt; nearRight: Pt; nearLeft: Pt }

/** Doubles court size in metres. Court coordinates: u across 0..1 (left to right), v along 0..1 (0 = far baseline, 1 = near baseline). */
export const COURT_W = 6.1;
export const COURT_L = 13.4;

type Mat3 = number[]; // row-major 3x3

/**
 * The perspective transform that sends the unit square to the four corners (in order: 0,0  1,0  1,1  0,1).
 * Uses the closed form for a square, which stays well behaved when the horizon passes through the image origin,
 * where fixing one matrix entry to 1 (the usual shortcut) breaks.
 */
function squareToQuad(q: Pt[]): Mat3 {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    if (Math.abs(den) < 1e-9) throw new Error('Court corners are degenerate');
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const m = [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
  const det = m[0] * (m[4] - m[5] * m[7]) - m[1] * (m[3] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) throw new Error('Court corners are degenerate');
  return m;
}

/** Adjugate: the inverse up to a scale factor, which is all a projective transform needs. */
function adjugate(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}

const apply = (m: Mat3, x: number, y: number): Pt => {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
};

export interface CourtMap {
  toScreen(u: number, v: number): Pt;
  toCourt(p: Pt): { u: number; v: number };
  /**
   * True for a picture point below the court's horizon, the line where the floor ends in the picture. Above it, a point cannot
   * be on the floor, and `toCourt` gives meaningless answers (it flips behind the camera).
   */
  belowHorizon(p: Pt): boolean;
}

/** Builds the court-to-screen mapping from the four outer corners of the doubles court as seen by the camera. */
export function courtMap(c: Corners): CourtMap {
  const fwd = squareToQuad([c.farLeft, c.farRight, c.nearRight, c.nearLeft]);
  const inv = adjugate(fwd);
  const wAt = (p: Pt) => inv[6] * p.x + inv[7] * p.y + inv[8];
  const wCentre = wAt(apply(fwd, 0.5, 0.5));
  return {
    belowHorizon: (p) => wAt(p) * wCentre > 0,
    toScreen: (u, v) => apply(fwd, u, v),
    toCourt: (p) => {
      const q = apply(inv, p.x, p.y);
      return { u: q.x, v: q.y };
    },
  };
}

/**
 * Where a picture point is on the court floor, and whether to trust it. A shuttle in the air is somewhere above the floor, and the
 * floor position of its picture point is only right when it is on the floor. So `air` is set, and the position is not to be used,
 * when the point is above the horizon or maps to somewhere well off the near and far ends. Only a shuttle on the floor can say
 * where it came down.
 */
export function floorPosition(map: CourtMap, p: Pt): { u: number; v: number; air: boolean } {
  const c = map.toCourt(p);
  const air = !map.belowHorizon(p) || !Number.isFinite(c.u) || !Number.isFinite(c.v) || c.v < -0.1 || c.v > 1.1;
  return { u: c.u, v: c.v, air };
}

const KEYS = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;

/** Corners as fractions of the screen, so a saved court does not depend on pixel size. */
export function normalizeCorners(c: Corners, w: number, h: number): Corners {
  const out = {} as Corners;
  for (const k of KEYS) out[k] = { x: c[k].x / w, y: c[k].y / h };
  return out;
}

export function denormalizeCorners(c: Corners, w: number, h: number): Corners {
  const out = {} as Corners;
  for (const k of KEYS) out[k] = { x: c[k].x * w, y: c[k].y * h };
  return out;
}

/** A starting guess for a phone on a tripod behind the near baseline. The user drags the corners to fit. */
export const defaultCorners = (w: number, h: number): Corners =>
  w > h
    ? { // landscape: the court is a tall trapezoid in the middle of a wide frame
        farLeft: { x: w * 0.4, y: h * 0.3 },
        farRight: { x: w * 0.6, y: h * 0.3 },
        nearRight: { x: w * 0.82, y: h * 0.88 },
        nearLeft: { x: w * 0.18, y: h * 0.88 },
      }
    : {
        farLeft: { x: w * 0.3, y: h * 0.34 },
        farRight: { x: w * 0.7, y: h * 0.34 },
        nearRight: { x: w * 0.95, y: h * 0.68 },
        nearLeft: { x: w * 0.05, y: h * 0.68 },
      };

const SINGLES_SIDE = 0.46 / COURT_W; // singles side line, 0.46 m inside the doubles line
const SHORT_SERVICE = 1.98 / COURT_L; // short service line, 1.98 m from the net
const LONG_SERVICE = 0.76 / COURT_L; // doubles long service line, 0.76 m inside the back line

type Seg = [[number, number], [number, number]];

/** Court markings in court coordinates, for drawing the outline. */
export const COURT_LINES: Seg[] = [
  [[0, 0], [1, 0]], [[0, 1], [1, 1]], [[0, 0], [0, 1]], [[1, 0], [1, 1]],
  [[SINGLES_SIDE, 0], [SINGLES_SIDE, 1]], [[1 - SINGLES_SIDE, 0], [1 - SINGLES_SIDE, 1]],
  [[0, 0.5 - SHORT_SERVICE], [1, 0.5 - SHORT_SERVICE]], [[0, 0.5 + SHORT_SERVICE], [1, 0.5 + SHORT_SERVICE]],
  [[0.5, 0], [0.5, 0.5 - SHORT_SERVICE]], [[0.5, 0.5 + SHORT_SERVICE], [0.5, 1]],
  [[0, LONG_SERVICE], [1, LONG_SERVICE]], [[0, 1 - LONG_SERVICE], [1, 1 - LONG_SERVICE]],
  [[0, 0.5], [1, 0.5]], // the net
];
