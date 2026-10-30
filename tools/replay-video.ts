/**
 * Runs the shuttle tracker over a recorded video, to see what it would find. Needs ffmpeg (with subtitle support to render).
 *   npx tsx tools/replay-video.ts clip.mp4 [y0] [out.json] [--render annotated.mp4]
 * With --render it writes a copy of the clip with the tracker's view drawn on it: small white squares for every candidate blob,
 * and a yellow ring with a "SHUTTLE" tag where it is following a track.
 * The area from row y0 (default 300) down is analysed at full size. The overlay RallyCam draws on the video (cards at the
 * top and bottom left) is masked, so it does not count as movement. Prints each track the tracker confirmed.
 */
import { writeFileSync } from 'node:fs';
import { runClip } from './lib/clip';
import { renderOverlay } from './lib/render';

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
  if (renderTo) renderOverlay(file, renderTo, rows);
});

