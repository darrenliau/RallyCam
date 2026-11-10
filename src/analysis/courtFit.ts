import { courtMap, type Corners, type Pt } from './court';

/** The marked lines of a doubles court (13.4 m by 6.1 m): 0.46 m between the side lines, the short service line 1.98 m from the net, the long one 0.76 m in. */
export const SINGLES = 0.46 / 6.1;
export const SHORT = 1.98 / 13.4;
export const LONG_BACK = 0.76 / 13.4;

/** A line in the picture: ax + by + c = 0 with a, b normalised, `angle` from horizontal in degrees (0 to 90), and how many white marks voted for it. */
export interface PictureLine { a: number; b: number; c: number; angle: number; votes: number }

interface TemplateLine {
  /** The line in court units: m0 u + m1 v + m2 = 0 (u across 0..1, v along 0..1, far end at 0). */
  m: [number, number, number];
  /** Where it is drawn, in court units. */
  from: [number, number];
  to: [number, number];
}

const alongU = (u: number, v0 = 0, v1 = 1): TemplateLine => ({ m: [1, 0, -u], from: [u, v0], to: [u, v1] });
const acrossV = (v: number): TemplateLine => ({ m: [0, 1, -v], from: [0, v], to: [1, v] });
/** The lines of the court that run along it and across it. The centre line is the one line u = 0.5 (it is drawn in the two service boxes). */
const ALONG = [alongU(0), alongU(1), alongU(SINGLES), alongU(1 - SINGLES), alongU(0.5, LONG_BACK, 1 - LONG_BACK)];
const ACROSS = [acrossV(0), acrossV(1), acrossV(0.5 - SHORT), acrossV(0.5 + SHORT), acrossV(LONG_BACK), acrossV(1 - LONG_BACK)];
export const TEMPLATE: TemplateLine[] = [...ALONG, ...ACROSS];

/** The eigenvector of the smallest eigenvalue of a symmetric matrix (Jacobi rotations). The matrices here are 9 x 9. */
function smallestEigenvector(sym: number[][]): number[] {
  const n = sym.length;
  const a = sym.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq; }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i][i] < a[best][best]) best = i;
  return v.map((row) => row[best]);
}

type Mat3 = number[];
const inverse3 = (m: Mat3): Mat3 | null => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
};

export interface LineMatch { template: TemplateLine; line: PictureLine; weight: number }

/**
 * Which picture line each line of a court placed at `corners` is. A line of the court counts as found when a picture line runs along its visible
 * part, within `tolerance` pixels and 4 degrees. Two court lines never share a picture line.
 */
export function matchLines(corners: Corners, lines: PictureLine[], w: number, h: number, tolerance: number): LineMatch[] {
  let map;
  try { map = courtMap(corners); } catch { return []; }
  const taken = new Map<PictureLine, { d: number; match: LineMatch }>();
  for (const t of TEMPLATE) {
    const pts: Pt[] = [];
    for (let k = 0; k <= 40; k++) {
      const s = k / 40;
      const p = map.toScreen(t.from[0] + (t.to[0] - t.from[0]) * s, t.from[1] + (t.to[1] - t.from[1]) * s);
      if (Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 2 && p.y >= 2 && p.x <= w - 2 && p.y <= h - 2) pts.push(p);
    }
    if (pts.length < 12) continue;
    const dx = pts[pts.length - 1].x - pts[0].x, dy = pts[pts.length - 1].y - pts[0].y, len = Math.hypot(dx, dy);
    if (len < 0.15 * w) continue;
    let best: { line: PictureLine; score: number; d: number } | null = null;
    for (const l of lines) {
      const d = pts.reduce((sum, p) => sum + Math.abs(l.a * p.x + l.b * p.y + l.c), 0) / pts.length;
      const angle = (Math.asin(Math.min(1, Math.abs(dx * l.a + dy * l.b) / len)) * 180) / Math.PI;
      if (d > tolerance || angle > 4) continue;
      const score = d + 2 * angle;
      if (!best || score < best.score) best = { line: l, score, d };
    }
    if (!best) continue;
    const prev = taken.get(best.line);
    if (!prev || best.d < prev.d) taken.set(best.line, { d: best.d, match: { template: t, line: best.line, weight: Math.sqrt(best.line.votes) * Math.min(1, len / (0.5 * w)) } });
  }
  return [...taken.values()].map((x) => x.match);
}

/** The court's four corners from lines of the picture and the court lines they are, by a weighted least squares fit of the whole plane-to-picture mapping. */
export function cornersFromMatches(matches: LineMatch[]): Corners | null {
  const along = matches.filter((m) => m.template.m[0] === 1).length;
  const across = matches.length - along;
  if (along < 2 || across < 3 || matches.length < 5) return null;
  const ata = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const add = (row: number[]) => { for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) ata[i][j] += row[i] * row[j]; };
  for (const { template, line, weight } of matches) {
    const m = template.m;
    const l = [line.a, line.b, line.c];
    // the picture line is the court line sent through the mapping G (l ~ G m): the cross product of the two is zero
    const r1 = new Array(9).fill(0), r2 = new Array(9).fill(0);
    for (let j = 0; j < 3; j++) {
      r1[3 + j] = -l[2] * m[j] * weight; r1[6 + j] = l[1] * m[j] * weight;
      r2[j] = l[2] * m[j] * weight; r2[6 + j] = -l[0] * m[j] * weight;
    }
    add(r1); add(r2);
  }
  const g = smallestEigenvector(ata);
  const inv = inverse3(g);
  if (!inv) return null;
  // points go through the inverse transpose of the line mapping
  const hm = [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
  const at = (u: number, v: number): Pt | null => {
    const wv = hm[6] * u + hm[7] * v + hm[8];
    if (!Number.isFinite(wv) || Math.abs(wv) < 1e-12) return null;
    return { x: (hm[0] * u + hm[1] * v + hm[2]) / wv, y: (hm[3] * u + hm[4] * v + hm[5]) / wv };
  };
  const fl = at(0, 0), fr = at(1, 0), nr = at(1, 1), nl = at(0, 1);
  if (!fl || !fr || !nr || !nl) return null;
  return { farLeft: fl, farRight: fr, nearRight: nr, nearLeft: nl };
}

/**
 * Settles a court on all the lines the picture shows. The corners of a court come from just four lines in the first guess, and a corner that is
 * far outside the picture moves a long way for a tiny turn of one of them. Here every court line that has a picture line (up to eleven) is used
 * at once, so the mapping, and the corners outside the picture, no longer hang on four lines. It matches lines, fits, and repeats on the new
 * position. Returns the corners unchanged when too few lines are found.
 */
export function refitFromLines(corners: Corners, lines: PictureLine[], w: number, h: number, rounds = 3): Corners {
  let current = corners;
  for (let round = 0; round < rounds; round++) {
    const matches = matchLines(current, lines, w, h, round === 0 ? 6 : 4);
    const next = cornersFromMatches(matches);
    if (!next) return current;
    current = next;
  }
  return current;
}
