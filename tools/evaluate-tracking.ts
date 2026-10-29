/**
 * Offline check of the player tracker on real footage.
 *
 *   python3 tools/detect_people.py data/raw/s01.mp4 --out data/predictions/s01_people.csv
 *   npx tsx tools/evaluate-tracking.ts --session s01 --singles
 *   npx tsx tools/evaluate-tracking.ts --session s01 --doubles --analysis-fps 15 --gt data/labels/s01_players.csv
 *
 * Reads  <data>/predictions/<session>_people.csv (+ .meta.json) and <data>/labels/<session>_court.json
 * Writes <data>/predictions/<session>_tracks.csv so you can look at the tracks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateTracking, formatReport, parseCourtJson, parseDetectionsCsv, parseGroundTruthCsv, type Meta } from '../src/analysis/evaluateTracking';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const session = opt('session');
if (!session || (!flag('singles') && !flag('doubles'))) {
  console.error('Usage: tsx tools/evaluate-tracking.ts --session <id> (--singles | --doubles) [--data data] [--analysis-fps 15] [--gt file.csv]');
  process.exit(1);
}
const data = opt('data') ?? 'data';
const peopleCsv = `${data}/predictions/${session}_people.csv`;
const meta: Meta = JSON.parse(readFileSync(`${peopleCsv}.meta.json`, 'utf8'));
const corners = parseCourtJson(JSON.parse(readFileSync(`${data}/labels/${session}_court.json`, 'utf8')));
const gtPath = opt('gt');
const per = flag('doubles') ? 2 : 1;

const { result, tracksCsv } = evaluateTracking(
  parseDetectionsCsv(readFileSync(peopleCsv, 'utf8')),
  meta,
  corners,
  { nNear: per, nFar: per, analysisFps: opt('analysis-fps') ? Number(opt('analysis-fps')) : undefined },
  gtPath ? parseGroundTruthCsv(readFileSync(gtPath, 'utf8')) : undefined,
);
writeFileSync(`${data}/predictions/${session}_tracks.csv`, tracksCsv);
console.log(formatReport(result));
