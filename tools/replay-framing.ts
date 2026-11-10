/**
 * Plays a shuttle track through the auto-framing controller (src/analysis/framing.ts) and reports what the view would have done.
 *
 *   npx tsx tools/replay-framing.ts ball.csv [--width 1920 --height 1080 --fps 60] [--seconds 120] [--start 0.5]
 *
 * ball.csv is a TrackNet csv (Frame,Visibility,X,Y in pixels). Only the shuttle is a subject here (no players), and the picture of the
 * clip stands for the full 0.5x frame. Prints the window once a second, then how often the shuttle was outside the window, the
 * fastest widening and tightening, and how many seconds were spent at each width.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { anyOutside, Framer, worldToView } from '../src/analysis/framing';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';

const args = process.argv.slice(2);
const flag = (n: string, d: number) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const file = args.find((a) => /\.csv(\.gz)?$/.test(a));
if (!file) { console.error('usage: tsx tools/replay-framing.ts ball.csv [--width W --height H --fps F --seconds S --start 0.5]'); process.exit(1); }
const W = flag('--width', 1920), H = flag('--height', 1080), fps = flag('--fps', 60), seconds = flag('--seconds', 120), start = flag('--start', 0.5);
const raw = readFileSync(file);
const text = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
const frames = parseTracknetCsv(text, fps).filter((r) => r.t <= seconds);

const framer = new Framer({ cx: 0.5, cy: 0.5, w: start });
let prev: { t: number; x: number; y: number } | null = null;
let seen = 0, outside = 0, lastPrintT = -1;
let fastestWiden = 0, fastestTighten = 0, lastW = start;
const timeAt = new Map<string, number>();
console.log('time   shuttle(x,y)   window (cx, cy, w)');
for (const f of frames) {
  const t = f.t;
  let subjects: { x: number; y: number; vx?: number; vy?: number }[] = [];
  if (f.track) {
    const x = f.track.x / W, y = f.track.y / H;
    const v = prev && t - prev.t > 0 && t - prev.t < 0.2 ? { vx: (x - prev.x) / (t - prev.t), vy: (y - prev.y) / (t - prev.t) } : {};
    subjects = [{ x, y, ...v }];
    prev = { t, x, y };
    seen++;
    if (anyOutside([{ x, y }], framer.window, 1)) outside++;
  }
  const w0 = framer.window.w;
  const win = framer.update(t, subjects);
  const rate = Math.log2(win.w / w0) / (1 / fps);
  if (rate > fastestWiden) fastestWiden = rate;
  if (-rate > fastestTighten) fastestTighten = -rate;
  lastW = win.w;
  const bucket = (Math.round(win.w * 10) / 10).toFixed(1);
  timeAt.set(bucket, (timeAt.get(bucket) ?? 0) + 1 / fps);
  if (t - lastPrintT >= 1 && f.track) {
    lastPrintT = t;
    const v = worldToView({ x: f.track.x / W, y: f.track.y / H }, win);
    console.log(`${t.toFixed(0).padStart(4)}   ${(f.track.x / W).toFixed(2)}, ${(f.track.y / H).toFixed(2)}   ${win.cx.toFixed(2)}, ${win.cy.toFixed(2)}, ${win.w.toFixed(2)}   (in view at ${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
  }
}
console.log(`\nShuttle seen in ${seen} frames, outside the window in ${outside} (${((100 * outside) / Math.max(1, seen)).toFixed(2)}%).`);
console.log(`Fastest widening ${fastestWiden.toFixed(2)} octaves/s, fastest tightening ${fastestTighten.toFixed(2)} octaves/s, ended at w ${lastW.toFixed(2)}.`);
console.log('Seconds at each width: ' + [...timeAt.entries()].sort().map(([w, s]) => `${w}: ${s.toFixed(0)} s`).join(', '));
