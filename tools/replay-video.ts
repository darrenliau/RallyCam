/**
 * Runs the shuttle tracker over a recorded video, to see what it would find. Needs ffmpeg (with subtitle support to render).
 *   npx tsx tools/replay-video.ts clip.mp4 [y0] [out.json] [--render annotated.mp4]
 * With --render it writes a copy of the clip with the tracker's view drawn on it: small white squares for every candidate blob,
 * and a yellow ring with a "SHUTTLE" tag where it is following a track.
 * The area from row y0 (default 300) down is analysed at full size. The overlay RallyCam draws on the video (cards at the
 * top and bottom left) is masked, so it does not count as movement. Prints each track the tracker confirmed.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ellipse, sceneToAss, type Scene, type SceneItem } from '../src/export/ass';
import { MotionShuttleTracker, type Box } from '../src/analysis/shuttleMotion';

const argv = process.argv.slice(2);
const renderAt = argv.indexOf('--render');
const renderTo = renderAt >= 0 ? argv[renderAt + 1] : undefined;
if (renderAt >= 0) argv.splice(renderAt, 2);
const [file, y0Arg, outFile] = argv;
if (!file) { console.error('usage: tsx tools/replay-video.ts clip.mp4 [y0] [out.json] [--render annotated.mp4]'); process.exit(1); }
const W = 1920;
const H = 1080;
const Y0 = Number(y0Arg ?? 300);
const h = H - Y0;
// RallyCam's cards, in the pixels of the watched area (the video is 1920 x 1080)
const cards: Box[] = [
  { x: 0, y: 0, w: 480, h: 420 - Y0 + 40 },        // court map (top left)
  { x: 1040, y: 0, w: 880, h: 40 },                  // nothing (kept for symmetry)
  { x: 1480, y: 0, w: 440, h: 330 - Y0 + 60 },       // shuttle cards (top right)
  { x: 0, y: 800 - Y0, w: 520, h: H - 800 },         // distance card (bottom left)
].filter((b) => b.h > 0).map((b) => ({ ...b, y: Math.max(0, b.y), h: Math.min(b.h, h) }));

const tracker = new MotionShuttleTracker();
const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=${W}:${h}:0:${Y0},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });

const frameBytes = W * h;
let buf = Buffer.alloc(0);
let n = 0;
type Row = { t: number; cands: number; shaky: boolean; boxes: { x: number; y: number }[]; track?: { x: number; y: number; vx: number; vy: number; hits: number } };
const rows: Row[] = [];
ff.stdout.on('data', (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    const frame = new Uint8Array(buf.subarray(0, frameBytes));
    buf = buf.subarray(frameBytes);
    const t = n / 60;
    const r = tracker.update(frame, W, h, t, cards);
    rows.push({ t, cands: r.candidates.length, shaky: r.shaky, boxes: r.candidates.map((c) => ({ x: c.x, y: c.y + Y0 })), track: r.track && r.track.misses === 0 ? { x: r.track.x, y: r.track.y + Y0, vx: r.track.vx, vy: r.track.vy, hits: r.track.hits } : undefined });
    n++;
  }
});
ff.on('close', () => {
  const tracks: Row[][] = [];
  let cur: Row[] = [];
  for (const r of rows) {
    if (r.track) cur.push(r);
    else if (cur.length) { tracks.push(cur); cur = []; }
  }
  if (cur.length) tracks.push(cur);
  console.log(`${n} frames, ${rows.filter((r) => r.cands > 0).length} with candidates, ${rows.filter((r) => r.shaky).length} shaky, ${tracks.length} tracks`);
  for (const t of tracks) {
    const a = t[0].track!;
    const b = t[t.length - 1].track!;
    console.log(`t=${t[0].t.toFixed(2)}s len=${t.length} from (${a.x.toFixed(0)},${a.y.toFixed(0)}) to (${b.x.toFixed(0)},${b.y.toFixed(0)}) speed ${Math.hypot(b.vx, b.vy).toFixed(0)} px/s`);
  }
  if (outFile) writeFileSync(outFile, JSON.stringify(rows));
  if (renderTo) render(rows, renderTo);
});

/** Draws what the tracker saw onto the clip: through an ASS subtitle file, the same way tools/burn-overlay.sh burns in the app's overlay. */
function render(all: Row[], to: string) {
  const items: SceneItem[] = [];
  const ms = (t: number) => Math.round(t * 1000);
  for (const r of all) {
    const a = ms(r.t);
    const b = ms(r.t + 1 / 60);
    for (const c of r.boxes) {
      items.push({ k: 's', l: 1, a, b, x: c.x - 4, y: c.y - 4, d: 'm 0 0 l 8 0 l 8 8 l 0 8', c: '#FFFFFF', o: 0, sw: 1.5, sc: '#FFFFFF' });
    }
    if (r.track) {
      const { x, y } = r.track;
      items.push({ k: 's', l: 3, a, b, x: x - 16, y: y - 16, d: ellipse(16, 16), c: '#FFD166', o: 0, sw: 3, sc: '#FFD166' });
      items.push({ k: 's', l: 4, a, b, x: x - 40, y: y - 52, d: 'm 0 0 l 80 0 l 80 22 l 0 22', c: '#05090A', o: 0.85 });
      items.push({ k: 't', l: 5, a, b, x, y: y - 49, s: 'SHUTTLE', z: 16, w: 1, an: 8, c: '#FFFFFF', sp: 0 });
    }
  }
  const scene: Scene = { width: W, height: H, items };
  const assFile = join(tmpdir(), `replay-${process.pid}.ass`);
  writeFileSync(assFile, sceneToAss(scene));
  // the subtitles filter wants colons and backslashes escaped in the path
  const escaped = assFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `subtitles='${escaped}'`, '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'copy', to], { stdio: 'inherit' });
  enc.on('close', (code) => console.log(code === 0 ? `Wrote ${to}` : `ffmpeg failed (${code}). Does your ffmpeg have subtitle support (libass)?`));
}
