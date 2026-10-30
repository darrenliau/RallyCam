/**
 * Scores TrackNetV3's output on a clip against the same labels as RallyCam's own tracker, side by side.
 *   npx tsx tools/compare-tracknet.ts clip.mp4 labels.json prediction.csv [--render annotated.mp4]
 * `prediction.csv` is what TrackNetV3's predict.py writes (see tools/run-tracknet.sh). With --render the clip is written out
 * with RallyCam's tracker drawn in yellow and TrackNet's shuttle in cyan, to look at where they agree and differ.
 */
import { readFileSync } from 'node:fs';
import { evaluate, formatMetrics, type Labels } from '../src/analysis/shuttleEval';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';
import { runClip } from './lib/clip';
import { renderOverlay } from './lib/render';

const args = process.argv.slice(2);
const renderAt = args.indexOf('--render');
const renderTo = renderAt >= 0 ? args[renderAt + 1] : undefined;
if (renderAt >= 0) args.splice(renderAt, 2);
const [file, labelFile, csvFile] = args;
if (!file || !labelFile || !csvFile) { console.error('usage: tsx tools/compare-tracknet.ts clip.mp4 labels.json prediction.csv [--render out.mp4]'); process.exit(1); }
const labels = JSON.parse(readFileSync(labelFile, 'utf8')) as Labels;

async function main() {
  const ours = await runClip(file, 300, {}, labels.fps);
  const theirs = parseTracknetCsv(readFileSync(csvFile, 'utf8'), labels.fps, ours.length);
  console.log(`RallyCam tracker   ${formatMetrics(evaluate(ours, labels))}`);
  console.log(`TrackNetV3         ${formatMetrics(evaluate(theirs, labels))}`);
  const inPlay = (t: number) => labels.playIntervals.some(([a, b]) => t >= a && t <= b);
  const outside = theirs.filter((f) => f.track && !inPlay(f.t)).length;
  const total = theirs.filter((f) => f.track).length;
  console.log(`TrackNet saw the shuttle in ${total} of ${theirs.length} frames, ${outside} of them outside the labelled flights.`);
  console.log('Note: the labels only cover the flights RallyCam\'s tracker found, so frames "outside" may be real shuttle that was never labelled. Look at the rendered clip before calling them false.');
  if (renderTo) await renderOverlay(file, renderTo, ours.map((r, i) => ({ t: r.t, boxes: [], track: r.track, other: theirs[i]?.track })));
}
main();
