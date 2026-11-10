/**
 * Plays a recording through the auto-framing controller (src/analysis/framing.ts) the way the Record screen does, for both ways of zooming
 * (crop: the window can pan; lens: it stays centred), and reports what the view would have done.
 *
 *   python3 tools/read_rings.py clip.mp4 --out rings.csv --every 3                      (the app's own player rings, read from the video)
 *   npx tsx tools/replay-framing.ts --rings rings.csv --corners corners.json [--ball ball.csv[.gz] --ball-offset 0 --ball-width 1920 --ball-height 1080]
 *                                   [--width 960 --height 540 --fps 60 --seconds 15] [--out prefix]
 *
 * The rings are in pixels of the clip they were read from (--width x --height); corners.json is the court as fractions of the frame. The
 * players are turned into the points the app holds in view (feet and head, `playerSubjects`) and the shuttle, if a TrackNet csv is given, into
 * `shuttleSubject`; the controller is stepped 8 times a second like record.tsx. With --out, writes prefix.crop.json and prefix.lens.json (the window
 * at each step, for tools/render-framing.py). Without --rings it uses the shuttle alone (a shuttle crossing the court keeps the view wide).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { courtMap, type Corners } from '../src/analysis/court';
import { anyOutside, Framer, startWindow, WIDE_RATIO, type Subject, type Window } from '../src/analysis/framing';
import { playerSubjects, shuttleSubject } from '../src/analysis/framingSubjects';
import type { Track } from '../src/analysis/players';
import { screenToFrame } from '../src/analysis/preprocess';
import { parseTracknetCsv } from '../src/analysis/tracknetCsv';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const W = Number(flag('--width', '960')), H = Number(flag('--height', '540')), fps = Number(flag('--fps', '60')), seconds = Number(flag('--seconds', '15'));
const STEP = 1 / 8;
const MARGIN = flag('--margin') != null ? Number(flag('--margin')) : undefined;
const PLAYER_LEAD = !args.includes('--no-player-lead');
const g = { frameAspect: W / H, screenW: W, screenH: H };

const cornersFile = flag('--corners');
const frac = cornersFile ? (JSON.parse(readFileSync(cornersFile, 'utf8')) as Corners) : null;
const px = (c: Corners, w: number, h: number): Corners => ({ farLeft: { x: c.farLeft.x * w, y: c.farLeft.y * h }, farRight: { x: c.farRight.x * w, y: c.farRight.y * h }, nearRight: { x: c.nearRight.x * w, y: c.nearRight.y * h }, nearLeft: { x: c.nearLeft.x * w, y: c.nearLeft.y * h } });
const map = frac ? courtMap(px(frac, W, H)) : null;

// --- players: the rings, one position per player per sample, outliers removed (as replay-game.ts does)
interface Ring { t: number; x: number; y: number }
const rings: Ring[][] = [[], [], [], []];
for (const file of (flag('--rings') ?? '').split(',').filter(Boolean)) {
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
    const xs = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.x).sort((a, b) => a - b);
    const ys = list.slice(Math.max(0, i - 3), i + 4).map((q) => q.y).sort((a, b) => a - b);
    if (Math.hypot(r.x - xs[xs.length >> 1], r.y - ys[ys.length >> 1]) < 90) keep.push(r);
  });
  list.length = 0;
  list.push(...keep);
}
const haveRings = rings.some((l) => l.length > 0) && map != null;
function tracksAt(t: number): Track[] {
  const out: Track[] = [];
  if (!map) return out;
  rings.forEach((list, id) => {
    let best: Ring | undefined;
    for (const r of list) if (Math.abs(r.t - t) <= 0.25 && (!best || Math.abs(r.t - t) < Math.abs(best.t - t))) best = r;
    if (best) { const c = map.toCourt({ x: best.x, y: best.y }); out.push({ id, u: c.u, v: c.v }); }
  });
  return out;
}

// --- the shuttle (optional): TrackNet positions as fractions of the frame
const ballFile = flag('--ball');
const shuttle: { t: number; x: number; y: number }[] = [];
if (ballFile) {
  const raw = readFileSync(ballFile);
  const text = (ballFile.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  const bw = Number(flag('--ball-width', '1920')), bh = Number(flag('--ball-height', '1080')), off = Number(flag('--ball-offset', '0'));
  for (const r of parseTracknetCsv(text, fps)) {
    const t = r.t - off;
    if (t >= 0 && t <= seconds && r.track) shuttle.push({ t, x: r.track.x / bw, y: r.track.y / bh });
  }
}
function shuttleAt(t: number) {
  const trail = shuttle.filter((s) => s.t <= t && t - s.t <= 0.3);
  return trail.length ? shuttleSubject(trail.map((s) => ({ x: s.x, y: s.y })), 0.3) : null;
}

if (!haveRings && !shuttle.length) { console.error('give --rings and --corners, or --ball'); process.exit(1); }
const courtPts = frac ? [frac.farLeft, frac.farRight, frac.nearRight, frac.nearLeft] : [];

interface Metrics { mode: string; steps: number; playersOutside: number; playersSeen: number; shuttleOutside: number; shuttleSeen: number; meanW: number; minW: number; maxW: number; fastestWiden: number; fastestTighten: number; timeAt: Record<string, number> }
function run(mode: 'crop' | 'lens') {
  const framer = new Framer(startWindow(courtPts), { panLocked: mode === 'lens', ...(MARGIN != null ? { margin: MARGIN } : {}) });
  framer.reset(startWindow(courtPts), 0);
  const windows: (Window & { t: number })[] = [{ t: 0, ...framer.window }];
  const m: Metrics = { mode, steps: 0, playersOutside: 0, playersSeen: 0, shuttleOutside: 0, shuttleSeen: 0, meanW: 0, minW: 1, maxW: 0, fastestWiden: 0, fastestTighten: 0, timeAt: {} };
  let prevW = framer.window.w;
  for (let t = STEP; t <= seconds; t += STEP) {
    const velocity = (id: number) => {
      if (!PLAYER_LEAD) return undefined;
      const now = tracksAt(t).find((x) => x.id === id), then = tracksAt(t - 0.5).find((x) => x.id === id);
      if (!now || !then || !map) return undefined;
      const a = screenToFrame(map.toScreen(then.u, then.v), g), b = screenToFrame(map.toScreen(now.u, now.v), g);
      return { vx: (b.x - a.x) / 0.5, vy: (b.y - a.y) / 0.5 };
    };
    const players = haveRings && map ? playerSubjects(tracksAt(t), map, g, velocity) : [];
    const ball = shuttleAt(t);
    const subjects: Subject[] = [...players, ...(ball ? [ball] : [])];
    const before = framer.window;
    // is what the viewer sees (the window as it was just before this step) missing someone?
    if (players.length) { m.playersSeen++; if (anyOutside(players, before, 1)) m.playersOutside++; }
    if (ball) { m.shuttleSeen++; if (anyOutside([ball], before, 1)) m.shuttleOutside++; }
    const win = framer.update(t, subjects);
    windows.push({ t, ...win });
    const rate = Math.log2(win.w / prevW) / STEP;
    m.fastestWiden = Math.max(m.fastestWiden, rate);
    m.fastestTighten = Math.max(m.fastestTighten, -rate);
    prevW = win.w;
    m.steps++; m.meanW += win.w; m.minW = Math.min(m.minW, win.w); m.maxW = Math.max(m.maxW, win.w);
    const key = (Math.round(win.w * 10) / 10).toFixed(1);
    m.timeAt[key] = (m.timeAt[key] ?? 0) + STEP;
  }
  m.meanW /= Math.max(1, m.steps);
  return { m, windows };
}

const outPrefix = flag('--out');
for (const mode of ['crop', 'lens'] as const) {
  const { m, windows } = run(mode);
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
  console.log(`\n== ${mode} (${mode === 'crop' ? 'window can pan' : 'centred zoom only'}) ==`);
  console.log(`window width: start ${windows[0].w.toFixed(2)}, mean ${m.meanW.toFixed(2)}, range ${m.minW.toFixed(2)}-${m.maxW.toFixed(2)} (1 = the whole picture, ${WIDE_RATIO} = the closer view)`);
  console.log(`players outside the view: ${m.playersOutside} of ${m.playersSeen} steps (${pct(m.playersOutside, m.playersSeen)})${haveRings ? '' : ' (no players given)'}`);
  console.log(`shuttle outside the view: ${m.shuttleOutside} of ${m.shuttleSeen} steps (${pct(m.shuttleOutside, m.shuttleSeen)})${shuttle.length ? '' : ' (no shuttle given)'}`);
  console.log(`fastest widening ${m.fastestWiden.toFixed(2)} octaves/s, fastest tightening ${m.fastestTighten.toFixed(2)} octaves/s`);
  console.log('seconds at each width: ' + Object.entries(m.timeAt).sort().map(([w, s]) => `${w}: ${s.toFixed(1)}`).join(', '));
  if (outPrefix) writeFileSync(`${outPrefix}.${mode}.json`, JSON.stringify({ mode, fps, width: W, height: H, step: STEP, windows, metrics: m }));
}
