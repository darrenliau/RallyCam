/**
 * How steady is the court finder? The camera does not move in a recording, so the court found in every frame should be the same one.
 *   npx tsx tools/court-stability.ts video.mp4 [--truth corners.json] [--from 0.5] [--to 12.5] [--every 0.5] [--cards] [--fuse 3 --gap 0.4]
 * --fuse N takes N looks `gap` seconds apart for every start time and finds the court from the marks that are in most of them (findCourtsInLooks).
 * For each frame it prints the first court's corners, its confidence, and how far it is from the truth (the part of the outline that is in the
 * picture, as phase0/labels/court is scored) or, without a truth, from the median of all the frames' first courts. Then the share of frames
 * within 0.03 picture widths, and what the app's own three-look consensus (consensusCourt over frames 0.4 s apart) gives.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { courtOutlineDistance as courtDistance, consensusCourt, findCourts, findCourtsInLooks, type CourtFit } from '../src/analysis/courtLines';
import type { Corners } from '../src/analysis/court';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => a.endsWith('.mp4') || a.endsWith('.mov'));
if (!file) { console.error('usage: tsx tools/court-stability.ts video.mp4 [--truth corners.json]'); process.exit(1); }
const W = 640;
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
const H = Math.round((W * probe[1]) / probe[0]);
const from = Number(flag('--from', '0.5')), to = Number(flag('--to', '12.5')), every = Number(flag('--every', '0.5'));
const cards: [number, number, number, number][] = [[0, 0, 0.26, 0.32], [0.27, 0, 0.73, 0.26], [0.76, 0, 1, 0.38], [0, 0.69, 0.28, 1]];
const truth = flag('--truth') ? (JSON.parse(readFileSync(flag('--truth')!, 'utf8')) as Corners) : null;
const keys = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;
const aspect = W / H;
const outline = (c: Corners) => {
  const pts: { x: number; y: number; inside: boolean }[] = [];
  const v = keys.map((k) => c[k]);
  for (let i = 0; i < 4; i++) for (let t = 0; t < 200; t++) {
    const a = v[i], b = v[(i + 1) % 4];
    const x = a.x + ((b.x - a.x) * t) / 200, y = a.y + ((b.y - a.y) * t) / 200;
    pts.push({ x, y: y / aspect, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 });
  }
  return pts;
};
const mean = (from: { x: number; y: number }[], to: { x: number; y: number }[]) => from.reduce((s, p) => s + Math.min(...to.map((q) => Math.hypot(p.x - q.x, p.y - q.y))), 0) / Math.max(1, from.length);
const outlineError = (a: Corners, b: Corners) => {
  const A = outline(a), B = outline(b);
  return (mean(A.filter((p) => p.inside), B) + mean(B.filter((p) => p.inside), A)) / 2;
};
const grab = (t: number) => new Uint8Array(execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 }));

const fuse = Number(flag('--fuse', '1')), gap = Number(flag('--gap', '0.4'));
const tops: { t: number; fit: CourtFit | null; others: CourtFit[] }[] = [];
for (let t = from; t <= to + 1e-9; t += every) {
  const opts = { ignore: args.includes('--cards') ? cards : undefined };
  const looks = Array.from({ length: fuse }, (_, k) => ({ data: grab(t + k * gap), width: W, height: H }));
  const list = fuse > 1 ? findCourtsInLooks(looks, opts, 3) : findCourts(looks[0], opts, 3);
  tops.push({ t, fit: list[0] ?? null, others: list.slice(1) });
}
const found = tops.filter((x) => x.fit);
// the reference: the truth, or the first court nearest to all the others
let ref: Corners | null = truth;
if (!ref && found.length) {
  let best = 0, bs = Infinity;
  found.forEach((x, i) => { const s = found.reduce((a, y) => a + courtDistance(x.fit!.corners, y.fit!.corners), 0); if (s < bs) { bs = s; best = i; } });
  ref = found[best].fit!.corners;
}
const f = (p: { x: number; y: number }) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
let close = 0;
for (const x of tops) {
  if (!x.fit || !ref) { console.log(`${x.t.toFixed(1)}s  nothing found`); continue; }
  const e = truth ? outlineError(x.fit.corners, truth) : courtDistance(x.fit.corners, ref);
  if (e <= 0.03) close++;
  const c = x.fit.corners;
  console.log(`${x.t.toFixed(1)}s  conf ${x.fit.confidence.toFixed(2)}  ${truth ? 'outline error' : 'distance from the typical court'} ${e.toFixed(3)}${e <= 0.03 ? '' : '  <- off'}   far ${f(c.farLeft)} ${f(c.farRight)}  near ${f(c.nearRight)} ${f(c.nearLeft)}`);
}
// how much each corner moves from frame to frame (the corners outside the picture are the unsteady ones)
if (found.length) {
  const spread = (k: typeof keys[number], ax: 'x' | 'y') => { const v = found.map((x) => x.fit!.corners[k][ax]).sort((a, b) => a - b); return v[v.length - 1] - v[0]; };
  const iqr = (k: typeof keys[number], ax: 'x' | 'y') => { const v = found.map((x) => x.fit!.corners[k][ax]).sort((a, b) => a - b); return v[Math.floor(v.length * 0.75)] - v[Math.floor(v.length * 0.25)]; };
  console.log('\ncorner movement over the frames (picture widths): range / middle half');
  for (const k of keys) console.log(`  ${k.padEnd(10)} x ${spread(k, 'x').toFixed(2)} / ${iqr(k, 'x').toFixed(2)}   y ${spread(k, 'y').toFixed(2)} / ${iqr(k, 'y').toFixed(2)}`);
}
console.log(`\n${close} of ${tops.length} frames within 0.03 of ${truth ? 'the marked court' : 'the typical court'}; nothing found in ${tops.length - found.length}`);
// the app takes three looks 0.4 s apart and uses the most agreeing one
let ok = 0, n = 0;
for (let i = 0; i + 2 < tops.length; i += 1) {
  const looks = [tops[i], tops[i + 1], tops[i + 2]].map((x) => x.fit).filter((x): x is CourtFit => !!x);
  const c = consensusCourt(looks);
  if (!c || !ref) continue;
  n++;
  const e = truth ? outlineError(c.corners, truth) : courtDistance(c.corners, ref);
  if (e <= 0.03) ok++;
}
console.log(`the app's three-look consensus (looks ${every} s apart here): ${ok} of ${n} within 0.03`);
