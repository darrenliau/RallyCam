import { courtMap, type Corners, type Pt } from './court';

/** A grey picture: one byte of brightness per pixel, row by row. */
export interface LumaImage { data: Uint8Array; width: number; height: number }

export interface CourtFit {
  /** The four outer corners of the doubles court, as fractions of the picture (they may fall outside it). */
  corners: Corners;
  /** How well the court's lines match white lines in the picture: 0 to 1. */
  confidence: number;
}

export interface FindOptions {
  /** Ignore the top part of the picture (ceiling lights are the main false lines). Fraction of the height. Default 0.38. */
  skipTop?: number;
  /** Rectangles (fractions of the picture: x0, y0, x1, y1) to treat as blank, for example text drawn over a recorded video. */
  ignore?: [number, number, number, number][];
}

/** The marked lines of a doubles court as segments in court units (u across 0..1, v along 0..1, far end at 0), 13.4 m by 6.1 m. */
const SINGLES = 0.46 / 6.1;
const SHORT = 1.98 / 13.4;
const LONG_BACK = 0.76 / 13.4;
const SEGMENTS: [number, number, number, number][] = [
  [0, 0, 1, 0], [0, 1, 1, 1], [0, 0, 0, 1], [1, 0, 1, 1],                       // outer: far and near baselines, side lines
  [SINGLES, 0, SINGLES, 1], [1 - SINGLES, 0, 1 - SINGLES, 1],                   // singles side lines
  [0, 0.5 - SHORT, 1, 0.5 - SHORT], [0, 0.5 + SHORT, 1, 0.5 + SHORT],           // short service lines
  [0, LONG_BACK, 1, LONG_BACK], [0, 1 - LONG_BACK, 1, 1 - LONG_BACK],           // doubles long service lines
  [0.5, 0.5 - SHORT, 0.5, LONG_BACK], [0.5, 0.5 + SHORT, 0.5, 1 - LONG_BACK],   // centre lines
];
/** How much a court far from the middle of the picture is marked down (0 to 1): the court being filmed is usually in the middle. */
const CENTRE_BIAS = 0.4;
/** Two courts closer than this (picture widths, see courtDistance) are the same candidate. */
const DISTINCT = 0.05;
/** Side lines are lines at least this steep (degrees from horizontal). A wide lens makes them shallower than the 22 degrees this used to be. */
const ALONG_MIN_ANGLE = 8;
const OUTER = 4; // the first four segments are the outer lines

interface Line { a: number; b: number; c: number; angle: number; votes: number }  // ax + by + c = 0 with a, b normalised, angle from horizontal (0..90)

/** White marks on the floor: brighter than their surroundings and brighter than most of the picture. */
function lineMask(img: LumaImage, skipTop: number, ignore: [number, number, number, number][] = []): Uint8Array {
  const { data, width: w, height: h } = img;
  const r = 5;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const y0 = Math.floor(h * skipTop);
  // brightness levels of the area we look at
  const hist = new Uint32Array(256);
  let count = 0;
  for (let y = y0; y < h; y += 2) for (let x = 0; x < w; x += 2) { hist[data[y * w + x]]++; count++; }
  const at = (q: number) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * count) return v; } return 255; };
  const p50 = at(0.5);
  const p97 = at(0.97);
  const bright = p50 + 0.45 * Math.max(10, p97 - p50);
  const contrast = Math.max(12, 0.18 * (p97 - p50));
  const mask = new Uint8Array(w * h);
  const blocked = (x: number, y: number) => ignore.some(([a, b, c, d]) => x >= a * w && x <= c * w && y >= b * h && y <= d * h);
  for (let y = Math.max(r, y0); y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const v = data[y * w + x];
      if (v < bright || blocked(x, y)) continue;
      const sum = integral[(y + r + 1) * (w + 1) + x + r + 1] - integral[(y - r) * (w + 1) + x + r + 1] - integral[(y + r + 1) * (w + 1) + x - r] + integral[(y - r) * (w + 1) + x - r];
      const mean = sum / ((2 * r + 1) * (2 * r + 1));
      if (v - mean >= contrast) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** The strongest straight lines through the marks, by Hough transform with the neighbours of each peak suppressed. */
function houghLines(mask: Uint8Array, w: number, h: number, max: number): Line[] {
  const thetas = 180;
  const diag = Math.ceil(Math.hypot(w, h));
  const rhos = 2 * diag + 1;
  const acc = new Uint16Array(thetas * rhos);
  const cos = new Float64Array(thetas);
  const sin = new Float64Array(thetas);
  for (let t = 0; t < thetas; t++) { cos[t] = Math.cos((t * Math.PI) / thetas); sin[t] = Math.sin((t * Math.PI) / thetas); }
  let points = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      points++;
      for (let t = 0; t < thetas; t++) acc[t * rhos + Math.round(x * cos[t] + y * sin[t]) + diag]++;
    }
  }
  if (!points) return [];
  const minVotes = Math.max(25, 0.07 * w);
  const lines: Line[] = [];
  for (let n = 0; n < max; n++) {
    let best = 0, bt = 0, br = 0;
    for (let t = 0; t < thetas; t++) for (let r = 0; r < rhos; r++) { const v = acc[t * rhos + r]; if (v > best) { best = v; bt = t; br = r; } }
    if (best < minVotes) break;
    // suppress the neighbourhood: nearby angles and positions are the same line
    for (let dt = -5; dt <= 5; dt++) {
      const t = (bt + dt + thetas) % thetas;
      const flip = bt + dt < 0 || bt + dt >= thetas; // wrapping past 0 or 180 degrees mirrors the position
      for (let dr = -9; dr <= 9; dr++) {
        const r = flip ? rhos - 1 - (br + dr) : br + dr;
        if (r >= 0 && r < rhos) acc[t * rhos + r] = 0;
      }
    }
    const theta = (bt * Math.PI) / thetas;
    const a = Math.cos(theta), b = Math.sin(theta), c = -(br - diag);
    let angle = (Math.atan2(Math.abs(-a), Math.abs(b)) * 180) / Math.PI; // angle of the line from horizontal
    if (!Number.isFinite(angle)) angle = 0;
    lines.push({ a, b, c, angle, votes: best });
  }
  return lines;
}

const intersect = (p: Line, q: Line): Pt | null => {
  const det = p.a * q.b - q.a * p.b;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (p.b * q.c - q.b * p.c) / det, y: (q.a * p.c - p.a * q.c) / det };
};

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The picture-space quad is plausible for a court seen from behind its near end: convex, far edge above and narrower than the near edge. */
function plausible(c: Corners, w: number, h: number): boolean {
  const { farLeft: fl, farRight: fr, nearRight: nr, nearLeft: nl } = c;
  const all = [fl, fr, nr, nl];
  if (all.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 4 * w || Math.abs(p.y) > 3 * h)) return false;
  if (!(fl.x < fr.x && nl.x < nr.x)) return false;
  if (!(fl.y < nl.y && fr.y < nr.y)) return false;
  const signs = [cross(fl, fr, nr), cross(fr, nr, nl), cross(nr, nl, fl), cross(nl, fl, fr)];
  if (!(signs.every((s) => s > 0) || signs.every((s) => s < 0))) return false;
  const far = fr.x - fl.x, near = nr.x - nl.x;
  if (far < 0.04 * w || near < far * 1.3 || near > far * 14) return false;
  // a court seen from behind one end is not a flat strip, not wider than a couple of pictures, and its ends run roughly level
  if (near > 2.5 * w) return false;
  if ((nl.y + nr.y) / 2 - (fl.y + fr.y) / 2 < 0.12 * h) return false;
  if (Math.abs(fr.y - fl.y) > 0.35 * far || Math.abs(nr.y - nl.y) > 0.35 * near) return false;
  // the court fills a good part of the picture: its near edge spans a third of the width at least. Tiny quads are marks on the floor, not the court
  if (near < 0.33 * w) return false;
  return true;
}

/**
 * How well a court placed at these corners matches the white marks. Every picture pixel a court line passes through counts once
 * (so a squashed court, whose lines all fall on the same pixels, cannot win by repeating them): a pixel on a white mark scores +1,
 * one that is not scores -0.4. Only the part of the lines inside the picture counts.
 */
function score(c: Corners, near: Uint8Array, w: number, h: number, stamp: Int32Array, gen: number, step = 1.5, blank?: Uint8Array): { value: number; outerHit: number; hitShare: number } {
  const map = courtMap(c);
  let value = 0, hit = 0, total = 0, outerHit = 0, outerTotal = 0;
  for (let s = 0; s < SEGMENTS.length; s++) {
    const [u0, v0, u1, v1] = SEGMENTS[s];
    const a = map.toScreen(u0, v0), b = map.toScreen(u1, v1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(len)) return { value: -1e9, outerHit: 0, hitShare: 0 };
    const steps = Math.min(600, Math.max(8, Math.ceil(len / step)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = map.toScreen(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (stamp[i] === gen) continue;
      stamp[i] = gen;
      if (blank && blank[i]) continue; // covered by something drawn over the picture: no evidence either way
      total++;
      const on = near[i] === 1;
      if (on) { value += 1; hit++; } else value -= 0.4;
      if (s < OUTER) { outerTotal++; if (on) outerHit++; }
    }
  }
  return { value, outerHit: outerTotal ? outerHit / outerTotal : 0, hitShare: total ? hit / total : 0 };
}

/** Court positions (along its length) a straight line across the picture can be: far baseline to near baseline. The net has no line on the floor. */
const ACROSS_V = [0, LONG_BACK, 0.5 - SHORT, 0.5 + SHORT, 1 - LONG_BACK, 1];
/** Which two of them the two chosen lines can be: the lower line is usually the near baseline or the near long service line. */
const V_PAIRS: [number, number][] = [];
for (const lower of [5, 4]) for (let upper = 0; upper < lower; upper++) V_PAIRS.push([ACROSS_V[upper], ACROSS_V[lower]]);
/** Positions across the court a straight line along it can be: the outer side lines, or the singles side lines. */
const ALONG_U: [number, number][] = [[0, 1], [SINGLES, 1 - SINGLES]];

/**
 * The four outer corners of the court, from where two lines along it and two lines across it are in the picture and which court
 * lines they are. The four lines are four sides of a rectangle on the floor whose size is known, which fixes how the floor maps to the
 * picture, and so where the whole court is, including corners the lines never reach.
 */
function outerCorners(left: Line, right: Line, upper: Line, lower: Line, uL: number, uR: number, vA: number, vB: number): Corners | null {
  const p00 = intersect(left, upper), p10 = intersect(right, upper), p11 = intersect(right, lower), p01 = intersect(left, lower);
  if (!p00 || !p10 || !p11 || !p01) return null;
  let map;
  try { map = courtMap({ farLeft: p00, farRight: p10, nearRight: p11, nearLeft: p01 }); } catch { return null; }
  const at = (u: number, v: number): Pt => map.toScreen((u - uL) / (uR - uL), (v - vA) / (vB - vA));
  return { farLeft: at(0, 0), farRight: at(1, 0), nearRight: at(1, 1), nearLeft: at(0, 1) };
}

/**
 * Finds the doubles court in a picture of it: the white marks, the straight lines through them, then the court whose outline,
 * side lines and service lines best fit those lines. A court seen from a low camera has its far half squeezed into a thin strip,
 * so the lines chosen need not include the far baseline: any two lines along and two across, taken as court lines of known position,
 * place the whole court. Returns the four outer corners (which may lie outside the picture), or null when nothing fits well enough.
 * A starting point for the user to correct, never the last word.
 */
export function findCourt(img: LumaImage, options: FindOptions = {}): CourtFit | null {
  return findCourts(img, options, 1)[0] ?? null;
}

/**
 * Like findCourt, but up to `count` different courts, best first (courts that are nearly the same are only listed once). In a hall
 * with several courts the right one is not always the best match, so the user can step through the others.
 */
export function findCourts(img: LumaImage, options: FindOptions = {}, count = 3): CourtFit[] {
  const { width: w, height: h } = img;
  const mask = lineMask(img, options.skipTop ?? 0.38, options.ignore);
  const lines = houghLines(mask, w, h, 44);
  // baselines and service lines run roughly across the picture, side lines run away from the camera. Only the strongest of each are tried.
  const across = lines.filter((l) => l.angle < 28).slice(0, 14);
  // with a wide lens or a low camera the side lines run at a shallow angle, so the two families overlap
  const along = lines.filter((l) => l.angle >= ALONG_MIN_ANGLE).slice(0, 12);
  if (across.length < 2 || along.length < 2) return [];
  const near = dilate(mask, w, h, 2);
  const stamp = new Int32Array(w * h);
  let gen = 0;
  // places the finder was told to ignore say nothing about the court, so a line that runs through them is neither right nor wrong there
  let blank: Uint8Array | undefined;
  if (options.ignore?.length) {
    blank = new Uint8Array(w * h);
    for (const [a, b, c2, d] of options.ignore) for (let y = Math.max(0, Math.floor(b * h)); y < Math.min(h, Math.ceil(d * h)); y++) for (let x = Math.max(0, Math.floor(a * w)); x < Math.min(w, Math.ceil(c2 * w)); x++) blank[y * w + x] = 1;
  }
  const rate = (c: Corners, coarse = false) => score(c, near, w, h, stamp, ++gen, coarse ? 7 : 1.5, blank);

  const xAt = (l: Line, y: number) => (-l.c - l.b * y) / (Math.abs(l.a) < 1e-9 ? 1e-9 : l.a);
  const yAt = (l: Line, x: number) => (-l.c - l.a * x) / (Math.abs(l.b) < 1e-9 ? 1e-9 : l.b);
  const centre = { x: w / 2, y: h * 0.62 };
  const shortlist: { c: Corners; v: number }[] = [];
  const keep = 16;
  for (let i = 0; i < along.length; i++) for (let j = i + 1; j < along.length; j++) {
    const [left, right] = xAt(along[i], h * 0.8) <= xAt(along[j], h * 0.8) ? [along[i], along[j]] : [along[j], along[i]];
    if (xAt(right, h * 0.8) - xAt(left, h * 0.8) < 0.06 * w) continue;
    for (let m = 0; m < across.length; m++) for (let n = m + 1; n < across.length; n++) {
      const [upper, lower] = yAt(across[m], w / 2) <= yAt(across[n], w / 2) ? [across[m], across[n]] : [across[n], across[m]];
      if (yAt(lower, w / 2) - yAt(upper, w / 2) < 0.02 * h) continue;
      for (const [uL, uR] of ALONG_U) for (const [vA, vB] of V_PAIRS) {
        const c = outerCorners(left, right, upper, lower, uL, uR, vA, vB);
        if (!c || !plausible(c, w, h)) continue;
        const sc = rate(c, true);
        const mid = { x: (c.farLeft.x + c.farRight.x + c.nearRight.x + c.nearLeft.x) / 4, y: (c.farLeft.y + c.farRight.y + c.nearRight.y + c.nearLeft.y) / 4 };
        const away = Math.hypot(mid.x - centre.x, mid.y - centre.y) / w;
        const v = sc.value * (1 - CENTRE_BIAS * Math.min(1, away));
        if (shortlist.length < keep) shortlist.push({ c, v });
        else {
          let worst = 0;
          for (let k = 1; k < shortlist.length; k++) if (shortlist[k].v < shortlist[worst].v) worst = k;
          if (v > shortlist[worst].v) shortlist[worst] = { c, v };
        }
      }
    }
  }
  if (!shortlist.length) return [];

  // Look closely at the best few, and nudge each corner a pixel or two at a time while the fit improves
  const keys = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;
  const f = (p: Pt): Pt => ({ x: p.x / w, y: p.y / h });
  const found: { fit: CourtFit; rank: number }[] = [];
  for (const cand of shortlist) {
    let corners = cand.c;
    let current = rate(corners).value;
    for (let pass = 0; pass < 5; pass++) {
      let improved = false;
      for (const k of keys) for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const trial: Corners = { ...corners, [k]: { x: corners[k].x + dx, y: corners[k].y + dy } };
        if (!plausible(trial, w, h)) continue;
        const v = rate(trial).value;
        if (v > current + 1e-9) { corners = trial; current = v; improved = true; }
      }
      if (!improved) break;
    }
    const final = rate(corners);
    if (final.hitShare < 0.3) continue;
    const mid = { x: (corners.farLeft.x + corners.farRight.x + corners.nearRight.x + corners.nearLeft.x) / 4, y: (corners.farLeft.y + corners.farRight.y + corners.nearRight.y + corners.nearLeft.y) / 4 };
    const away = Math.hypot(mid.x - centre.x, mid.y - centre.y) / w;
    found.push({
      fit: {
        corners: { farLeft: f(corners.farLeft), farRight: f(corners.farRight), nearRight: f(corners.nearRight), nearLeft: f(corners.nearLeft) },
        confidence: Math.max(0, Math.min(1, (final.hitShare - 0.3) / 0.4)),
      },
      rank: current * (1 - CENTRE_BIAS * Math.min(1, away)),
    });
  }
  found.sort((a, b) => b.rank - a.rank);
  // courts that are nearly the same are one candidate
  const out: CourtFit[] = [];
  for (const { fit } of found) {
    if (out.every((o) => courtDistance(o.corners, fit.corners) > DISTINCT)) out.push(fit);
    if (out.length >= count) break;
  }
  return out;
}

/** For the tools that draw what the finder sees. */
export const internals = { lineMask, houghLines, dilate, score, plausible };

const KEYS = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;

/** Average distance (in picture widths, y scaled by the picture's shape) between the same corners of two courts. */
export function courtDistance(a: Corners, b: Corners, aspect = 16 / 9): number {
  let sum = 0;
  for (const k of KEYS) sum += Math.hypot(a[k].x - b[k].x, (a[k].y - b[k].y) / aspect);
  return sum / KEYS.length;
}

/**
 * Several looks at the same court (a few pictures a moment apart, with players in different places): keeps the one that agrees best
 * with the others, so a look spoilt by a player standing on a line is outvoted. With a single look, that look is returned with its
 * confidence halved, since nothing confirms it.
 */
export function consensusCourt(fits: CourtFit[]): CourtFit | null {
  if (!fits.length) return null;
  if (fits.length === 1) return { corners: fits[0].corners, confidence: fits[0].confidence * 0.5 };
  let best = 0, bestSpread = Infinity;
  fits.forEach((f, i) => {
    const others = fits.filter((_, j) => j !== i).map((o) => courtDistance(f.corners, o.corners));
    const spread = others.reduce((s, d) => s + d, 0) / others.length;
    if (spread < bestSpread) { bestSpread = spread; best = i; }
  });
  // looks that disagree wildly are not looks at the same court: say so with a low confidence
  const agreement = Math.max(0, 1 - bestSpread / 0.15);
  return { corners: fits[best].corners, confidence: fits[best].confidence * (0.4 + 0.6 * agreement) };
}
