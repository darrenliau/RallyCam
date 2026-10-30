/**
 * Scores the shuttle tracker on a clip against hand-made labels.
 *   npx tsx tools/evaluate-shuttle.ts clip.mp4 labels.json [--compare]
 * `labels.json` is { "fps": 60, "playIntervals": [[t0, t1], ...], "points": [{ "t": 1.2, "x": 840, "y": 410 }, ...] }
 * with times in seconds and positions in pixels of the 1920 x 1080 frame (see phase0/labels/ for examples).
 * With --compare it also runs the tracker with the new path check turned off, to show what that check changes.
 */
import { readFileSync } from 'node:fs';
import { evaluate, formatMetrics, type Labels } from '../src/analysis/shuttleEval';
import { runClip } from './lib/clip';

const args = process.argv.slice(2);
const compare = args.includes('--compare');
const [file, labelFile] = args.filter((a) => !a.startsWith('--'));
if (!file || !labelFile) { console.error('usage: tsx tools/evaluate-shuttle.ts clip.mp4 labels.json [--compare]'); process.exit(1); }
const labels = JSON.parse(readFileSync(labelFile, 'utf8')) as Labels;

async function main() {
  const variants: [string, Parameters<typeof runClip>[2]][] = [['with path check', {}]];
  if (compare) variants.unshift(['without path check', { pathWindow: 0 }]);
  for (const [name, options] of variants) {
    const rows = await runClip(file, 300, options, labels.fps);
    console.log(`${name.padEnd(20)} ${formatMetrics(evaluate(rows, labels))}`);
  }
}
main();
