/**
 * Names the shots of a recording with the app's own logic (shuttle model's track, court gate, the player nearest the shuttle at each turn,
 * ShuttleEstimator, classifyShot) so they can be checked and corrected by eye. There is no body pose offline, so the hand height is unknown and
 * every call is made from where the players stood, how far the shuttle went and how fast (confidence at most 0.55).
 *
 *   npx tsx tools/label-shots.ts --rings rings.csv --corners corners.json --ball ball.csv.gz --ball-json ball.json --names Wing,Mia,Darren,Jun
 *                                [--ball-offset 0] [--seconds 15] [--gate] [--players 0,2] [--out shots.json]
 *
 * rings.csv is from tools/read_rings.py (players 0 to 3 = lime, teal, purple, pink, so the names go in that order). Prints a table; with --out also
 * writes the shots as JSON for tools/burn-shot-labels.sh.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { courtMap, type Corners } from '../src/analysis/court';
import { courtRegion } from '../src/analysis/courtRegion';
import { hitterSide } from '../src/analysis/hitter';
import { ModelTrackFilter, type ModelFrame } from '../src/analysis/modelTrack';
import type { Track } from '../src/analysis/players';
import { ShuttleEstimator } from '../src/analysis/shuttleStats';
import { classifyShot } from '../src/analysis/shots';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const names = (flag('--names', 'lime,teal,purple,pink')!).split(',');
const ballFile = flag('--ball')!, ballJson = flag('--ball-json') ?? ballFile.replace(/\.csv(\.gz)?$/, '.json');
const meta = JSON.parse(readFileSync(ballJson, 'utf8'));
const fps = Number(meta.fps ?? 60), W = Number(meta.width ?? 1920), H = Number(meta.height ?? 1080);
const offset = Number(flag('--ball-offset', '0')), seconds = Number(flag('--seconds', '15'));
const frac = JSON.parse(readFileSync(flag('--corners')!, 'utf8')) as Corners;
const CLIP_W = Number(flag('--clip-width', '960')), CLIP_H = Number(flag('--clip-height', '540'));
const px = (c: Corners, w: number, h: number): Corners => ({ farLeft: { x: c.farLeft.x * w, y: c.farLeft.y * h }, farRight: { x: c.farRight.x * w, y: c.farRight.y * h }, nearRight: { x: c.nearRight.x * w, y: c.nearRight.y * h }, nearLeft: { x: c.nearLeft.x * w, y: c.nearLeft.y * h } });
const clipMap = courtMap(px(frac, CLIP_W, CLIP_H));
const frameMap = courtMap(px(frac, W, H));

interface Ring { t: number; x: number; y: number }
const rings: Ring[][] = [[], [], [], []];
for (const file of flag('--rings')!.split(',')) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    const [, t, p, x, y] = line.split(',');
    if (p === undefined || p === '') continue;
    rings[Number(p)].push({ t: Number(t), x: Number(x), y: Number(y) });
  }
}
for (const list of rings) {
  list.sort((a, b) => a.t - b.t);
  const keep: Ring[] = [];
  list.forEach((r, i) => {
    const xs = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.x).sort((a, b) => a - b), ys = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.y).sort((a, b) => a - b);
    if (Math.hypot(r.x - xs[xs.length >> 1], r.y - ys[ys.length >> 1]) < 90) keep.push(r);
  });
  list.length = 0; list.push(...keep);
}
const ONLY = (flag('--players') ?? '').split(',').filter(Boolean).map(Number);
if (ONLY.length) rings.forEach((l, i) => { if (!ONLY.includes(i)) l.length = 0; });   // for example singles: 0 (lime) and 2 (purple)
function tracksAt(t: number): Track[] {
  const out: Track[] = [];
  rings.forEach((list, id) => {
    let best: Ring | undefined;
    for (const r of list) if (Math.abs(r.t - t) <= 0.25 && (!best || Math.abs(r.t - t) < Math.abs(best.t - t))) best = r;
    if (best) { const c = clipMap.toCourt({ x: best.x, y: best.y }); out.push({ id, u: c.u, v: c.v }); }
  });
  return out;
}

const text = (ballFile.endsWith('.gz') ? gunzipSync(readFileSync(ballFile)) : readFileSync(ballFile)).toString('utf8');
const raw = parseTracknetCsv(text, fps, meta.frames).filter((r) => r.t >= offset && r.t <= offset + seconds);
const frames: ModelFrame[] = raw.map((r) => (r.track ? { t: r.t - offset, x: r.track.x / W, y: r.track.y / H } : { t: r.t - offset }));
const filter = new ModelTrackFilter();
if (args.includes('--gate')) filter.setRegion(courtRegion(frac));
const estimator = new ShuttleEstimator(
  (x, y) => { const c = frameMap.toCourt({ x: x * W, y: y * H }); return { u: c.u, v: c.v, air: !frameMap.belowHorizon({ x: x * W, y: y * H }) }; },
  (hit) => {
    const tracks = tracksAt(hit.t);
    if (!tracks.length) return undefined;
    const h = hitterSide({ x: hit.x * CLIP_W, y: hit.y * CLIP_H }, tracks, clipMap);
    return h ? { u: h.track.u, v: h.track.v, track: h.track.id } : null;
  },
);
const shots: ReturnType<ShuttleEstimator['takeShots']> = [];
for (let i = 0; i + 8 <= frames.length; i += 8) {
  for (const s of filter.push(frames.slice(i, i + 8))) { estimator.push(s); shots.push(...estimator.takeShots()); }
}
estimator.newRally();
shots.push(...estimator.takeShots());

// Two hits in a row by the same side (players 0 and 1 are one side, 2 and 3 the other) within 1.5 s are not both real: the shuttle turned twice
// near the same player (a noisy track, or one swing seen twice). Keep the first of such a run, then name each shot again from the next kept hit.
const side = (track?: number) => (track == null ? '?' : track < 2 ? 'A' : 'B');
const kept: typeof shots = [];
for (const s of shots) {
  const prev = kept[kept.length - 1];
  if (prev && side(prev.track) === side(s.track) && side(s.track) !== '?' && s.t - prev.t < 1.5 && !args.includes('--keep-repeats')) continue;
  kept.push(s);
}
const named = kept.map((s, i) => {
  const next = kept[i + 1];
  const r = classifyShot({ number: i + 1, from: s.from, to: next ? next.from : s.to, seconds: next ? next.t - s.t : null });
  return { ...s, type: r.type, confidence: r.confidence, kmh: r.kmh, metres: r.metres, number: i + 1 };
});

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
console.log(`${shots.length} turns of the shuttle with a player near, ${shots.length - kept.length} dropped as a repeat by the same side, ${named.length} kept.\n`);
console.log('time   player    type       sure   speed     distance  from -> to (metres from the net)');
const rows = named.map((s) => ({
  t: s.t, player: s.track != null ? names[s.track] : '?', type: s.type, confidence: s.confidence, kmh: s.kmh, metres: s.metres,
  from: s.from, to: s.to, number: s.number,
}));
for (const r of rows) {
  const net = (f: { v: number } | null) => (f ? `${(Math.abs(f.v - 0.5) * 13.4).toFixed(1)} m` : '-');
  console.log(`${clock(r.t).padEnd(6)} ${r.player.padEnd(9)} ${r.type.padEnd(10)} ${r.confidence.toFixed(2)}  ${(r.kmh ? Math.round(r.kmh) + ' km/h' : '-').padEnd(9)} ${(r.metres ? r.metres.toFixed(1) + ' m' : '-').padEnd(9)} ${net(r.from)} -> ${net(r.to)}`);
}
if (flag('--out')) writeFileSync(flag('--out')!, JSON.stringify(rows));
