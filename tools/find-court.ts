/**
 * Runs the court-line finder on a picture or a video frame and prints the corners it finds.
 *   npx tsx tools/find-court.ts frame.png [--at 12.5] [--expect corners.json] [--cards] [--out result.json]
 * --cards ignores the score, court map and distance cards RallyCam draws into its own recorded videos. A video is read at --at seconds. The picture is shrunk to 640 wide, as the app does. With --expect, the distance of each found
 * corner from the expected one is printed, as a fraction of the picture's width.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { findCourt } from '../src/analysis/courtLines';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a) => !a.startsWith('--') && !/^\d/.test(a) && a !== flag('--expect') && a !== flag('--out') && a !== flag('--at') && a !== flag('--width'));
if (!file) { console.error('usage: tsx tools/find-court.ts frame.png [--at seconds] [--expect corners.json] [--out result.json]'); process.exit(1); }
const W = Number(flag('--width') ?? 640);
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
const H = Math.round((W * probe[1]) / probe[0] / 2) * 2;
const ffArgs = ['-v', 'error', ...(flag('--at') ? ['-ss', flag('--at')!] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
const raw = execFileSync('ffmpeg', ffArgs, { maxBuffer: 1 << 26 });
const t0 = Date.now();
// RallyCam's own cards, drawn into its recorded videos: top left, top centre, top right, bottom left
const cards: [number, number, number, number][] = [[0, 0, 0.26, 0.32], [0.27, 0, 0.73, 0.26], [0.76, 0, 1, 0.38], [0, 0.69, 0.28, 1]];
const fit = findCourt({ data: new Uint8Array(raw), width: W, height: H }, { ignore: args.includes('--cards') ? cards : undefined });
const ms = Date.now() - t0;
if (!fit) { console.log(`No court found (${ms} ms)`); process.exit(0); }
const f = (p: { x: number; y: number }) => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
console.log(`found in ${ms} ms, confidence ${fit.confidence.toFixed(2)}`);
console.log(`  far left ${f(fit.corners.farLeft)}  far right ${f(fit.corners.farRight)}\n  near left ${f(fit.corners.nearLeft)}  near right ${f(fit.corners.nearRight)}`);
if (flag('--expect')) {
  const exp = JSON.parse(readFileSync(flag('--expect')!, 'utf8')) as typeof fit.corners;
  const keys = ['farLeft', 'farRight', 'nearRight', 'nearLeft'] as const;
  const errs = keys.map((k) => Math.hypot(fit.corners[k].x - exp[k].x, (fit.corners[k].y - exp[k].y) * (H / W)));
  console.log('  distance from expected, in picture widths: ' + keys.map((k, i) => `${k} ${errs[i].toFixed(3)}`).join(', '));
}
if (flag('--out')) writeFileSync(flag('--out')!, JSON.stringify(fit));
