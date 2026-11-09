import type { LumaImage } from './courtLines';

/** The pictures are shrunk to this width for the comparison: a shift of one pixel here is 0.6% of the picture. */
const WIDTH = 160;
/** The furthest a shift is looked for, in these pixels (7.5% of the picture): a bump to the tripod is small, anything more is a new view. */
const RANGE = 12;

/** The picture as WIDTH wide brightness values, by averaging the pixels that fall in each new one. */
function shrink(img: LumaImage): { data: Float32Array; w: number; h: number } {
  const w = WIDTH;
  const h = Math.max(8, Math.round((WIDTH * img.height) / img.width));
  const out = new Float32Array(w * h);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += img.data[yy * img.width + xx]; n++; }
      out[y * w + x] = n ? sum / n : 0;
    }
  }
  return { data: out, w, h };
}

/** How fast brightness changes at each point (edges), so that the lighting does not matter, only where the structures are. */
function edges(a: { data: Float32Array; w: number; h: number }): Float32Array {
  const { data, w, h } = a;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    out[y * w + x] = Math.abs(data[y * w + x + 1] - data[y * w + x - 1]) + Math.abs(data[(y + 1) * w + x] - data[(y - 1) * w + x]);
  }
  return out;
}

export interface Shift {
  /** How far the picture has moved since the reference, as a fraction of its width (right is positive) and of its height (down is positive). */
  dx: number;
  dy: number;
  /** How well the two pictures agree at that shift, 0 to 1. Low means they are not the same view (or there is too little in the picture to tell). */
  quality: number;
}

/** Edges of a reference picture, kept so that each new picture is only shrunk once. */
export interface Reference { e: Float32Array; w: number; h: number }
export const reference = (img: LumaImage): Reference => { const s = shrink(img); return { e: edges(s), w: s.w, h: s.h }; };

/**
 * How far the camera has moved between the reference picture and this one, by sliding one over the other and finding where their
 * edges agree best (normalised correlation over the part that overlaps). People moving about change only a small part of the
 * edges, so the best shift stays where the fixed things (the court, the net, the walls) put it. Resolves about a third of a pixel of
 * the shrunk picture by fitting a curve through the peak.
 */
export function shiftFrom(ref: Reference, img: LumaImage): Shift {
  const cur = edges(shrink(img));
  const { w, h } = ref;
  const score = (dx: number, dy: number) => {
    const x0 = Math.max(1, dx), x1 = Math.min(w - 1, w + dx), y0 = Math.max(1, dy), y1 = Math.min(h - 1, h + dy);
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const a = cur[y * w + x], b = ref.e[(y - dy) * w + (x - dx)];
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
    }
    if (n < 50) return -1;
    const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
    return va > 1e-6 && vb > 1e-6 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : -1;
  };
  const grid: number[][] = [];
  let best = { dx: 0, dy: 0, s: -2 };
  for (let dy = -RANGE; dy <= RANGE; dy++) {
    grid.push([]);
    for (let dx = -RANGE; dx <= RANGE; dx++) {
      const s = score(dx, dy);
      grid[dy + RANGE].push(s);
      if (s > best.s) best = { dx, dy, s };
    }
  }
  // fit a parabola through the peak and its neighbours, along each direction, for a fraction of a pixel
  const at = (dx: number, dy: number) => (Math.abs(dx) <= RANGE && Math.abs(dy) <= RANGE ? grid[dy + RANGE][dx + RANGE] : null);
  const refine = (m: number | null, c: number, p: number | null) => {
    if (m === null || p === null) return 0;
    const d = m - 2 * c + p;
    return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d));
  };
  const fx = refine(at(best.dx - 1, best.dy), best.s, at(best.dx + 1, best.dy));
  const fy = refine(at(best.dx, best.dy - 1), best.s, at(best.dx, best.dy + 1));
  return { dx: (best.dx + fx) / w, dy: (best.dy + fy) / h, quality: Math.max(0, Math.min(1, best.s)) };
}
