/**
 * Runs the court finder on the stills in phase0/labels/court/ and compares what it finds with the corners marked by hand.
 *   npx tsx tools/court-regression.ts [--candidates 4]
 * Each label file has a still (shrunk to 640 wide, as the app does), the true corners as fractions of the picture, and boxes to ignore
 * (the app's own chips and cards, when the still is a screenshot). Prints, for every candidate, its confidence and its distance from the
 * truth in picture widths (corners compared in the four cyclic orders; the smallest counts), and whether the first one is close.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { findCourts } from '../src/analysis/courtLines';
import type { Corners } from '../src/analysis/court';

const DIR = 'phase0/labels/court/';
const args = process.argv.slice(2);
const count = Number(args[args.indexOf('--candidates') + 1] || 4);
const CLOSE = 0.03;
const keys = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;
/** The court's outline as points, 200 along each side, in picture widths (y scaled by the picture's shape). */
const outline = (c: Corners, aspect: number) => {
  const pts: { x: number; y: number; inside: boolean }[] = [];
  const v = keys.map((k) => c[k]);
  for (let i = 0; i < 4; i++) {
    const a = v[i], b = v[(i + 1) % 4];
    for (let t = 0; t < 200; t++) {
      const x = a.x + ((b.x - a.x) * t) / 200, y = a.y + ((b.y - a.y) * t) / 200;
      pts.push({ x, y: y / aspect, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 });
    }
  }
  return pts;
};
/** How far the part of one court's outline that is in the picture is from the other's outline, on average (picture widths). Corners outside the picture cannot be seen or dragged, so they count only through the lines they make. */
const outlineError = (found: Corners, truth: Corners, aspect: number) => {
  const a = outline(found, aspect).filter((p) => p.inside), b = outline(truth, aspect), a2 = outline(found, aspect), b2 = outline(truth, aspect).filter((p) => p.inside);
  const mean = (from: { x: number; y: number }[], to: { x: number; y: number }[]) => from.reduce((sum, p) => sum + Math.min(...to.map((q) => Math.hypot(p.x - q.x, p.y - q.y))), 0) / Math.max(1, from.length);
  return (mean(a, b) + mean(b2, a2)) / 2;
};
const rotate = (c: Corners, n: number): Corners => {
  const v = keys.map((k) => c[k]);
  return { farLeft: v[n % 4], farRight: v[(n + 1) % 4], nearRight: v[(n + 2) % 4], nearLeft: v[(n + 3) % 4] };
};

let closeFirst = 0, total = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const label = JSON.parse(readFileSync(DIR + file, 'utf8')) as { still: string; kind: string; corners: Corners; ignore: [number, number, number, number][] };
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', DIR + label.still]).toString().trim().split(',').map(Number);
  const W = 640, H = Math.round((W * probe[1]) / probe[0]);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', DIR + label.still, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
  const t0 = Date.now();
  const fits = findCourts({ data: new Uint8Array(raw), width: W, height: H }, { ignore: label.ignore }, count);
  const aspect = W / H;
  const err = (c: Corners) => Math.min(...[0, 1, 2, 3].map((n) => outlineError(c, rotate(label.corners, n), aspect)));
  console.log(`${file.replace('.json', '')} (${label.kind} view, ${Date.now() - t0} ms): ${fits.length} candidate(s)`);
  fits.forEach((f, i) => console.log(`  ${i + 1}. confidence ${f.confidence.toFixed(2)}, outline error ${err(f.corners).toFixed(3)} picture widths${err(f.corners) <= CLOSE ? '  <- close' : ''}`));
  if (label.kind === 'behind') { total++; if (fits[0] && err(fits[0].corners) <= CLOSE) closeFirst++; }
}
console.log(`\nbehind-the-end stills where the first candidate is within ${CLOSE}: ${closeFirst} of ${total}`);
