/**
 * Plays a recorded shuttle track (from phase0/tools/run-coreml-video.sh) through the same logic the app uses while recording:
 * the sighting filter, the shuttle estimator, the court map, and the rally-end and winner rules. It prints each rally it finds.
 * No court is needed: the recording stands in for the game.
 *
 *   npx tsx tools/analyze-track.ts new_coreml_ball.csv --corners corners.json [--singles] [--first-server A|B] [--out rallies.json]
 *
 * `corners.json` is the four outer corners of the doubles court in the video, as fractions of the frame (0 to 1, from the top left):
 *   { "farLeft": {"x":.., "y":..}, "farRight": {..}, "nearRight": {..}, "nearLeft": {..} }
 * The matching `new_coreml_ball.json` (fps, width, height) is read from next to the CSV, or give --fps --width --height.
 * There are no players and no game state here. The serve check is skipped. Who hit last comes from serve order (the sides take
 * turns, starting with the server, and the winner of a point serves the next), starting from --first-server (default A, the side
 * nearest the camera). So one wrong shot count can flip a result and carry on into the following rallies; read the list as a test of
 * the shuttle path and the landing, not as a score. A shuttle seen only high in the air (above the court's horizon in the picture)
 * has no floor position, and a rally that ends that way is reported as undecided.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { courtMap, floorPosition, type Corners } from '../src/analysis/court';
import { ModelTrackFilter, type ModelFrame } from '../src/analysis/modelTrack';
import { isRallyOver, judgeRally, landingCall } from '../src/analysis/rallyEnd';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';
import { ShuttleEstimator } from '../src/analysis/shuttleStats';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const singles = args.includes('--singles');
const csvFile = args.find((a) => !a.startsWith('--') && a.endsWith('.csv'));
if (!csvFile || !flag('--corners')) {
  console.error('usage: tsx tools/analyze-track.ts track.csv --corners corners.json [--singles] [--out rallies.json]');
  process.exit(1);
}
const metaFile = csvFile.replace(/\.csv$/, '.json');
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const fps = Number(flag('--fps') ?? meta.fps ?? 60);
const width = Number(flag('--width') ?? meta.width ?? 1920);
const height = Number(flag('--height') ?? meta.height ?? 1080);
const corners = JSON.parse(readFileSync(flag('--corners')!, 'utf8')) as Corners;

// The court map in a frame of 1920 x 1080 units, so frame fractions map straight onto it
const px = (p: { x: number; y: number }) => ({ x: p.x * 1920, y: p.y * 1080 });
const map = courtMap({ farLeft: px(corners.farLeft), farRight: px(corners.farRight), nearRight: px(corners.nearRight), nearLeft: px(corners.nearLeft) });
const toFloor = (x: number, y: number) => floorPosition(map, { x: x * 1920, y: y * 1080 });

const raw = parseTracknetCsv(readFileSync(csvFile, 'utf8'), fps, meta.frames);
const frames: ModelFrame[] = raw.map((r) => (r.track ? { t: r.t, x: r.track.x / width, y: r.track.y / height } : { t: r.t }));

const filter = new ModelTrackFilter();
const estimator = new ShuttleEstimator(toFloor);
const SEQ = 8;
let server: 'A' | 'B' = (flag('--first-server') ?? 'A') === 'B' ? 'B' : 'A';
let undecided = 0;
interface Rally { n: number; start: number; end: number; shots: number; first: { u: number; v: number } | null; last: { u: number; v: number } | null; inBounds: boolean | null; winner: string; confidence: number; reason: string }
const rallies: Rally[] = [];
let accepted = 0;
const acceptedTimes: number[] = [];

for (let i = 0; i + SEQ <= frames.length; i += SEQ) {
  const windowFrames = frames.slice(i, i + SEQ);
  const now = windowFrames[SEQ - 1].t;
  for (const s of filter.push(windowFrames)) { estimator.push(s); accepted++; acceptedTimes.push(s.t); }
  const trace = estimator.trace();
  if (!isRallyOver(trace, now, singles)) continue;
  const byParity: 'A' | 'B' = trace.shots % 2 === 1 ? server : server === 'A' ? 'B' : 'A';
  const verdict = judgeRally(trace, now, singles, undefined, byParity);
  if (!verdict && trace.shots >= 2) undecided++;
  if (verdict && trace.firstSeen && trace.lastSeen) {
    server = verdict.winner;
    const landed = trace.lastSeen.air ? trace.lastFloor ?? trace.lastSeen : trace.lastSeen;
    const land = landingCall(landed, singles);
    rallies.push({
      n: rallies.length + 1, start: trace.firstSeen.t, end: trace.lastSeen.t, shots: trace.shots,
      first: { u: trace.firstSeen.u, v: trace.firstSeen.v }, last: { u: landed.u, v: landed.v },
      inBounds: land.inBounds, winner: verdict.winner, confidence: verdict.confidence, reason: verdict.reason,
    });
  }
  estimator.newRally();
  filter.reset();
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
console.log(`${frames.length} frames (${(frames.length / fps / 60).toFixed(1)} min), the model saw the shuttle in ${frames.filter((f) => f.x !== undefined).length}, ${accepted} sightings passed the filter.`);
console.log(`${rallies.length} rallies with a decision, ${undecided} more that ended with the shuttle lost in the air or with no one to blame (no point).\n`);
console.log('  #   from     to      shots  last seen at (across, along)  in?   winner  sure   why');
for (const r of rallies) {
  console.log(`${String(r.n).padStart(3)}   ${mmss(r.start)}  ${mmss(r.end)}  ${String(r.shots).padStart(4)}   (${r.last!.u.toFixed(2)}, ${r.last!.v.toFixed(2)})`.padEnd(66)
    + `${r.inBounds ? 'in ' : 'out'}   ${r.winner}       ${r.confidence.toFixed(2)}   ${r.reason}`);
}
const a = rallies.filter((r) => r.winner === 'A').length;
console.log(`\nSide A (nearest the camera) wins ${a}, side B ${rallies.length - a}. Low "sure" values are near a line or the net, or short.`);
if (flag('--out')) writeFileSync(flag('--out')!, JSON.stringify({ fps, rallies }, null, 1));
