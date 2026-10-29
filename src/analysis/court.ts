export interface Pt { x: number; y: number }
export interface Corners { farLeft: Pt; farRight: Pt; nearRight: Pt; nearLeft: Pt }

/** Doubles court size in metres. Court coordinates: u across 0..1 (left to right), v along 0..1 (0 = far baseline, 1 = near baseline). */
export const COURT_W = 6.1;
export const COURT_L = 13.4;

/** Solve the 8 parameters of a perspective transform that sends each src point to its dst point. */
function solve(src: Pt[], dst: Pt[]): number[] {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    m.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    m.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('Court corners are degenerate');
    for (let k = c; k < 9; k++) m[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = m[r][c];
      for (let k = c; k < 9; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row) => row[8]);
}

const apply = (h: number[], x: number, y: number): Pt => {
  const w = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
};

export interface CourtMap {
  toScreen(u: number, v: number): Pt;
  toCourt(p: Pt): { u: number; v: number };
}

/** Builds the court-to-screen mapping from the four outer corners of the doubles court as seen by the camera. */
export function courtMap(c: Corners): CourtMap {
  const unit: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const quad = [c.farLeft, c.farRight, c.nearRight, c.nearLeft];
  const fwd = solve(unit, quad);
  const inv = solve(quad, unit);
  return {
    toScreen: (u, v) => apply(fwd, u, v),
    toCourt: (p) => {
      const q = apply(inv, p.x, p.y);
      return { u: q.x, v: q.y };
    },
  };
}

/** A starting guess for a phone on a tripod behind the near baseline. The user drags the corners to fit. */
export const defaultCorners = (w: number, h: number): Corners => ({
  farLeft: { x: w * 0.3, y: h * 0.34 },
  farRight: { x: w * 0.7, y: h * 0.34 },
  nearRight: { x: w * 0.95, y: h * 0.68 },
  nearLeft: { x: w * 0.05, y: h * 0.68 },
});

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
