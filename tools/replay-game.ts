/**
 * Plays a recording through the app's live logic with the players known: the shuttle model's track, the court gate, the hitter (the
 * nearest tracked player to the shuttle at each turn), turns with nobody near thrown out, and the speed of each shot.
 *
 *   python3 tools/read_rings.py clip-1.mp4 --out rings1.csv --offset-frames 0         (the app's own rings, read from the video)
 *   npx tsx tools/replay-game.ts ball.csv --corners corners.json --rings rings1.csv,rings2.csv [--gate] [--players-on-court] [--seconds 45]
 *
 * `ball.csv` / `ball.json` are from phase0/tools/run-coreml-video.sh (positions in the video's pixels), `corners.json` the court corners
 * as fractions of the frame, and the rings files from read_rings.py, in pixels of the 960 x 540 clips they were read from. Prints each hit
 * with who was near the shuttle, and the estimator's speed of the shot that ended with it. --players-on-court drops rings that are on other courts (more than --margin, default 0.15, of the court's size outside it), as the app's tracker does once the right court is set.
 */
import { existsSync, readFileSync } from 'node:fs';
import { courtMap, type Corners } from '../src/analysis/court';
import { courtRegion } from '../src/analysis/courtRegion';
import { hitterSide } from '../src/analysis/hitter';
import { ModelTrackFilter, type ModelFrame } from '../src/analysis/modelTrack';
import type { Track } from '../src/analysis/players';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';
import { ShuttleEstimator } from '../src/analysis/shuttleStats';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ballFile = args.find((a) => a.endsWith('.csv') && !a.includes('rings'));
if (!ballFile || !flag('--corners') || !flag('--rings')) { console.error('usage: tsx tools/replay-game.ts ball.csv --corners corners.json --rings a.csv,b.csv [--gate] [--seconds 45]'); process.exit(1); }
const meta = JSON.parse(readFileSync(ballFile.replace(/\.csv$/, '.json'), 'utf8'));
const fps = Number(meta.fps ?? 60), W = Number(meta.width ?? 1920), H = Number(meta.height ?? 1080);
const seconds = Number(flag('--seconds') ?? 45);
const frac = JSON.parse(readFileSync(flag('--corners')!, 'utf8')) as Corners;
const CLIP_W = 960, CLIP_H = 540;                         // the rings were read from 960 x 540 clips
const px = (c: Corners, w: number, h: number): Corners => ({ farLeft: { x: c.farLeft.x * w, y: c.farLeft.y * h }, farRight: { x: c.farRight.x * w, y: c.farRight.y * h }, nearRight: { x: c.nearRight.x * w, y: c.nearRight.y * h }, nearLeft: { x: c.nearLeft.x * w, y: c.nearLeft.y * h } });
const clipMap = courtMap(px(frac, CLIP_W, CLIP_H));
const frameMap = courtMap(px(frac, 1920, 1080));

// --- the rings: one position per player per sample, outliers removed
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
    const near = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.x).sort((a, b) => a - b);
    const nearY = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.y).sort((a, b) => a - b);
    if (Math.hypot(r.x - near[near.length >> 1], r.y - nearY[nearY.length >> 1]) < 90) keep.push(r);
  });
  list.length = 0;
  list.push(...keep);
}
const MARGIN = Number(flag('--margin') ?? 0.15);
/** The tracked players at time t (a ring within 0.25 s counts as seen). */
function tracksAt(t: number): Track[] {
  const out: Track[] = [];
  rings.forEach((list, id) => {
    let best: Ring | undefined;
    for (const r of list) if (Math.abs(r.t - t) <= 0.25 && (!best || Math.abs(r.t - t) < Math.abs(best.t - t))) best = r;
    if (best) {
      const c = clipMap.toCourt({ x: best.x, y: best.y });
      // a person well outside the court is on another court, not a player (as the app's tracker does with the court it was given)
      if (args.includes('--players-on-court') && (c.u < -MARGIN || c.u > 1 + MARGIN || c.v < -MARGIN || c.v > 1 + MARGIN)) return;
      out.push({ id, u: c.u, v: c.v });
    }
  });
  return out;
}

// --- the shuttle: the model's track, gated, into the estimator that knows the hitters
const raw = parseTracknetCsv(readFileSync(ballFile, 'utf8'), fps, meta.frames).filter((r) => r.t <= seconds);
const frames: ModelFrame[] = raw.map((r) => (r.track ? { t: r.t, x: r.track.x / W, y: r.track.y / H } : { t: r.t }));
const filter = new ModelTrackFilter();
if (args.includes('--gate')) filter.setRegion(courtRegion(frac));
interface Hit { t: number; who: string; dist: number; at: { u: number; v: number } | null | undefined }
const hits: Hit[] = [];
const estimator = new ShuttleEstimator(
  (x, y) => { const c = frameMap.toCourt({ x: x * 1920, y: y * 1080 }); return { u: c.u, v: c.v, air: !frameMap.belowHorizon({ x: x * 1920, y: y * 1080 }) }; },
  (hit) => {
    const tracks = tracksAt(hit.t);
    if (!tracks.length) { hits.push({ t: hit.t, who: 'no players seen', dist: NaN, at: undefined }); return undefined; }
    const h = hitterSide({ x: hit.x * CLIP_W, y: hit.y * CLIP_H }, tracks, clipMap);
    hits.push({ t: hit.t, who: h ? ['lime', 'teal', 'purple', 'pink'][h.track.id] : 'nobody near', dist: h ? h.distance : NaN, at: h ? { u: h.track.u, v: h.track.v } : null });
    return h ? { u: h.track.u, v: h.track.v } : null;
  },
);
const speeds: { t: number; kmh: number; shots: number }[] = [];
let accepted = 0;
for (let i = 0; i + 8 <= frames.length; i += 8) {
  for (const s of filter.push(frames.slice(i, i + 8))) { const before = estimator.trace().shots; estimator.push(s); accepted++; const st = estimator.stats(s.t); if (st && estimator.trace().shots !== before) speeds.push({ t: s.t, kmh: st.speedKmh, shots: st.shots }); }
}
console.log(`${seconds} s: the model saw the shuttle in ${raw.filter((r) => r.track).length} frames, ${accepted} samples passed the filter${args.includes('--gate') ? ' and the court gate' : ''}.`);
console.log(`Rings read for the players: ${rings.map((l, i) => ['lime', 'teal', 'purple', 'pink'][i] + ' ' + l.length).join(', ')}.\n`);
console.log('time    hit by          nearness (body heights)   shot speed after');
for (const h of hits) {
  const sp = speeds.filter((s) => Math.abs(s.t - h.t) < 0.3)[0];
  console.log(`${h.t.toFixed(2).padStart(6)}  ${h.who.padEnd(15)} ${(Number.isNaN(h.dist) ? '-' : h.dist.toFixed(2)).padStart(8)}              ${sp && sp.kmh > 0 ? sp.kmh + ' km/h' : ''}`);
}
const real = hits.filter((h) => h.who !== 'nobody near' && h.who !== 'no players seen');
console.log(`\n${hits.length} turns of the shuttle: ${real.length} with a player near (counted as hits), ${hits.filter((h) => h.who === 'nobody near').length} with nobody near (not hits), ${hits.filter((h) => h.who === 'no players seen').length} with no players seen.`);
console.log(`Speeds shown: ${speeds.filter((s) => s.kmh > 0).map((s) => s.kmh).join(', ') || 'none'}`);
