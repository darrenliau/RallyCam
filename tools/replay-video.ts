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
import { H, W, runClip, type ClipRow } from './lib/clip';

const argv = process.argv.slice(2);
const renderAt = argv.indexOf('--render');
const renderTo = renderAt >= 0 ? argv[renderAt + 1] : undefined;
if (renderAt >= 0) argv.splice(renderAt, 2);
const [file, y0Arg, outFile] = argv;
if (!file) { console.error('usage: tsx tools/replay-video.ts clip.mp4 [y0] [out.json] [--render annotated.mp4]'); process.exit(1); }
const Y0 = Number(y0Arg ?? 300);

runClip(file, Y0).then((rows) => {
  const tracks: typeof rows[] = [];
  let cur: typeof rows = [];
  for (const r of rows) {
    if (r.track) cur.push(r);
    else if (cur.length) { tracks.push(cur); cur = []; }
  }
  if (cur.length) tracks.push(cur);
  console.log(`${rows.length} frames, ${rows.filter((r) => r.cands > 0).length} with candidates, ${rows.filter((r) => r.shaky).length} shaky, ${tracks.length} tracks`);
  tracks.forEach((t, i) => {
    const a = t[0].track!;
    const b = t[t.length - 1].track!;
    console.log(`#${i} t=${t[0].t.toFixed(2)}s len=${t.length} from (${a.x.toFixed(0)},${a.y.toFixed(0)}) to (${b.x.toFixed(0)},${b.y.toFixed(0)}) speed ${Math.hypot(b.vx, b.vy).toFixed(0)} px/s`);
  });
  if (outFile) writeFileSync(outFile, JSON.stringify(rows));
  if (renderTo) render(rows, renderTo);
});

/** Draws what the tracker saw onto the clip: through an ASS subtitle file, the same way tools/burn-overlay.sh burns in the app's overlay. */
function render(all: ClipRow[], to: string) {
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
