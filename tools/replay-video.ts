/**
 * Runs the shuttle tracker over a recorded video, to see what it would find. Needs ffmpeg.
 *   npx tsx tools/replay-video.ts clip.mp4 [y0] [out.json]
 * The area from row y0 (default 300) down is analysed at full size. The overlay RallyCam draws on the video (cards at the
 * top and bottom left) is masked, so it does not count as movement. Prints each track the tracker confirmed.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { MotionShuttleTracker, type Box } from '../src/analysis/shuttleMotion';

const [file, y0Arg, outFile] = process.argv.slice(2);
if (!file) { console.error('usage: tsx tools/replay-video.ts clip.mp4 [y0] [out.json]'); process.exit(1); }
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
type Row = { t: number; cands: number; shaky: boolean; track?: { x: number; y: number; vx: number; vy: number; hits: number } };
const rows: Row[] = [];
ff.stdout.on('data', (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    const frame = new Uint8Array(buf.subarray(0, frameBytes));
    buf = buf.subarray(frameBytes);
    const t = n / 60;
    const r = tracker.update(frame, W, h, t, cards);
    rows.push({ t, cands: r.candidates.length, shaky: r.shaky, track: r.track && r.track.misses === 0 ? { x: r.track.x, y: r.track.y + Y0, vx: r.track.vx, vy: r.track.vy, hits: r.track.hits } : undefined });
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
});
