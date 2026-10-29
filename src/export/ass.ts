import { courtMap, type CourtMap } from '../analysis/court';
import { cornersInBox, SNAPSHOT_MAX_AGE_MS, stateAt, type OverlayData, type OverlaySnapshot } from '../analysis/overlay';
import { COURT_LINES } from '../analysis/court';
import { currentGame, gamesWon, serverName } from '../engine/scoring';
import type { MatchConfig, MatchState, Rally } from '../engine/types';

/**
 * Turns the overlay saved while recording into an ASS subtitle file. ASS can draw shapes and text on top of a
 * video, so the same file works three ways: open it next to the video in VLC or IINA, or burn it into a new
 * video with ffmpeg (see tools/burn-overlay.sh). The layout follows the in-app overlay, drawn on a 780 wide canvas.
 */

export interface AssInput {
  config: MatchConfig;
  rallies: Rally[];
  overlay: OverlayData;
  durationMs: number;
  /** Overlay updates per second. Players glide between updates, so 2 looks smooth and keeps the file small. */
  updatesPerSecond?: number;
  fontName?: string;
  /** Leave out the shuttle cards while there is no shuttle data (see src/config.ts). */
  hideEmptyShuttle?: boolean;
}

const DESIGN_W = 780;
const NEAR = ['#C8F04A', '#3FD6C6'];
const FAR = ['#A98BFF', '#FF6F9A'];

// --- small helpers --------------------------------------------------------------------------------------------

/** ASS time: h:mm:ss.cc */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** '#RRGGBB' to ASS's '&HBBGGRR&'. */
export function assColor(hex: string): string {
  const h = hex.replace('#', '');
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** Opacity 0..1 to an ASS alpha value (00 opaque, FF clear). */
export function assAlpha(opacity: number): string {
  const a = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
  return `&H${a.toString(16).padStart(2, '0')}&`.toUpperCase();
}

/** Names are typed by the user. Braces and backslashes would be read as ASS commands. */
export const assText = (s: string): string => s.replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ');

const n1 = (n: number) => Math.round(n * 10) / 10;

/** Drawing commands for a rounded rectangle with its top left corner at 0,0. */
export function roundRect(w: number, h: number, r: number): string {
  const [W, H, R] = [n1(w), n1(h), n1(Math.min(r, w / 2, h / 2))];
  return `m ${R} 0 l ${n1(W - R)} 0 b ${W} 0 ${W} 0 ${W} ${R} l ${W} ${n1(H - R)} b ${W} ${H} ${W} ${H} ${n1(W - R)} ${H} l ${R} ${H} b 0 ${H} 0 ${H} 0 ${n1(H - R)} l 0 ${R} b 0 0 0 0 ${R} 0`;
}

/** Drawing commands for an ellipse with its bounding box top left at 0,0. */
export function ellipse(rx: number, ry: number): string {
  const k = 0.5523;
  const [cx, cy, kx, ky] = [rx, ry, rx * k, ry * k].map(n1);
  const [w, h] = [n1(2 * rx), n1(2 * ry)];
  return `m ${w} ${cy} b ${w} ${n1(cy + ky)} ${n1(cx + kx)} ${h} ${cx} ${h} b ${n1(cx - kx)} ${h} 0 ${n1(cy + ky)} 0 ${cy} b 0 ${n1(cy - ky)} ${n1(cx - kx)} 0 ${cx} 0 b ${n1(cx + kx)} 0 ${w} ${n1(cy - ky)} ${w} ${cy}`;
}

/**
 * One thing to draw for a stretch of the video, in a 1920 wide coordinate space. The ASS writer below and the
 * on-phone exporter (modules/rallycam-export) both draw from the same list, so they look alike.
 */
export interface SceneShape {
  k: 's';
  l: number; // layer, drawn low to high
  a: number; // start, ms
  b: number; // end, ms
  x: number; // top left of the shape
  y: number;
  mx?: number; // where it glides to by the end
  my?: number;
  d: string; // path in ASS drawing commands: m (move), l (line), b (cubic curve)
  c: string; // fill colour '#RRGGBB'
  o: number; // fill opacity 0..1 (0 = no fill)
  sc?: string; // outline colour
  sw?: number; // outline width
}

export interface SceneText {
  k: 't';
  l: number;
  a: number;
  b: number;
  x: number;
  y: number;
  mx?: number;
  my?: number;
  s: string;
  z: number; // font size
  w: 0 | 1; // bold
  an: 7 | 8 | 9; // x is the left / centre / right edge of the text, y is its top
  c: string;
  sp: number; // letter spacing
}

export type SceneItem = SceneShape | SceneText;

export interface Scene {
  width: number;
  height: number;
  items: SceneItem[];
}

interface Ctx {
  k: number; // design px to scene px
  items: SceneItem[];
  /** Leave out the shuttle cards while there is nothing to show in them. */
  hideEmptyShuttle?: boolean;
}

type Anchor = 7 | 8 | 9; // top left / top centre / top right

interface Pos { x: number; y: number }

/** A shape. `pos` is the top left of the shape. */
function shape(c: Ctx, layer: number, a: number, b: number, drawing: string, pos: Pos, fill: string, opacity: number, opts: { stroke?: { width: number; color: string }; move?: { to: Pos } } = {}) {
  if (b - a < 10) return;
  c.items.push({
    k: 's', l: layer, a, b, x: n1(pos.x), y: n1(pos.y), d: drawing, c: fill, o: opacity,
    ...(opts.move ? { mx: n1(opts.move.to.x), my: n1(opts.move.to.y) } : {}),
    ...(opts.stroke ? { sw: n1(opts.stroke.width), sc: opts.stroke.color } : {}),
  });
}

/** Text. `pos` is the top left / top centre / top right depending on the anchor. */
function label(c: Ctx, layer: number, a: number, b: number, text: string, pos: Pos, size: number, color: string, opts: { bold?: boolean; anchor?: Anchor; spacing?: number; move?: { to: Pos } } = {}) {
  if (b - a < 10) return;
  c.items.push({
    k: 't', l: layer, a, b, x: n1(pos.x), y: n1(pos.y), s: assText(text), z: n1(size * c.k), w: opts.bold ? 1 : 0, an: opts.anchor ?? 7, c: color, sp: opts.spacing ?? 0,
    ...(opts.move ? { mx: n1(opts.move.to.x), my: n1(opts.move.to.y) } : {}),
  });
}

// --- time segments --------------------------------------------------------------------------------------------

interface Seg { start: number; end: number; snap?: OverlaySnapshot; next?: OverlaySnapshot }

/** Splits the video into stretches that either show one snapshot or show "no data". */
export function buildSegments(snaps: OverlaySnapshot[], durationMs: number, stride: number): Seg[] {
  const kept: OverlaySnapshot[] = [];
  for (const s of snaps) if (!kept.length || s.t - kept[kept.length - 1].t >= stride) kept.push(s);
  const out: Seg[] = [];
  let cursor = 0;
  kept.forEach((s, i) => {
    if (s.t > cursor) out.push({ start: cursor, end: s.t });
    const next = kept[i + 1];
    const contiguous = next !== undefined && next.t - s.t <= SNAPSHOT_MAX_AGE_MS;
    const end = Math.min(durationMs, contiguous ? next.t : s.t + SNAPSHOT_MAX_AGE_MS);
    if (end > s.t) out.push({ start: s.t, end, snap: s, next: contiguous ? next : undefined });
    cursor = Math.max(cursor, end);
  });
  if (cursor < durationMs) out.push({ start: cursor, end: durationMs });
  return out;
}

/** Joins neighbouring stretches that would draw exactly the same thing. */
function merged<T>(segs: Seg[], key: (s: Seg) => T): { start: number; end: number; seg: Seg }[] {
  const out: { start: number; end: number; seg: Seg; key: string }[] = [];
  for (const s of segs) {
    const k = JSON.stringify(key(s));
    const last = out[out.length - 1];
    if (last && last.key === k && last.end === s.start) last.end = s.end;
    else out.push({ start: s.start, end: s.end, seg: s, key: k });
  }
  return out;
}

// --- overlay pieces -------------------------------------------------------------------------------------------

const BACK = '#05090A';
const MUTED = '#8FA198';
const SOFT = '#C6D3CC';
const LIME = '#C8F04A';

function scoreboard(c: Ctx, state: MatchState, a: number, b: number) {
  const g = currentGame(state);
  const w = gamesWon(state);
  const { A, B } = state.config.players;
  const bw = 360;
  const x0 = (DESIGN_W - bw) / 2;
  const y0 = 10;
  const k = c.k;
  shape(c, 10, a, b, roundRect(bw * k, 84 * k, 16 * k), { x: x0 * k, y: y0 * k }, BACK, 0.78);
  label(c, 11, a, b, A.join(' & ').toUpperCase(), { x: (x0 + 14) * k, y: (y0 + 8) * k }, 11, state.serve.side === 'A' ? '#FFFFFF' : SOFT, { bold: true, spacing: 1 });
  label(c, 11, a, b, B.join(' & ').toUpperCase(), { x: (x0 + bw - 14) * k, y: (y0 + 8) * k }, 11, state.serve.side === 'B' ? '#FFFFFF' : SOFT, { bold: true, spacing: 1, anchor: 9 });
  label(c, 11, a, b, String(g.A), { x: (x0 + 14) * k, y: (y0 + 20) * k }, 40, '#FFFFFF', { bold: true });
  label(c, 11, a, b, String(g.B), { x: (x0 + bw - 14) * k, y: (y0 + 20) * k }, 40, '#FFFFFF', { bold: true, anchor: 9 });
  label(c, 11, a, b, state.serve.side === 'A' ? '◀ serving' : 'serving ▶', { x: (x0 + bw / 2) * k, y: (y0 + 34) * k }, 11, SOFT, { bold: true, anchor: 8 });
  if (state.config.bestOf > 1) {
    label(c, 11, a, b, `Games ${w.A}`, { x: (x0 + 14) * k, y: (y0 + 62) * k }, 11, SOFT);
    label(c, 11, a, b, `Games ${w.B}`, { x: (x0 + bw - 14) * k, y: (y0 + 62) * k }, 11, SOFT, { anchor: 9 });
  }
  const line = state.matchWinner ? 'Game over' : `${serverName(state)} serves from the ${state.serve.court} court`;
  label(c, 11, a, b, line, { x: (x0 + bw / 2) * k, y: (y0 + 66) * k }, 11, SOFT, { anchor: 8 });
}

function shuttleCards(c: Ctx, snap: OverlaySnapshot | undefined, a: number, b: number) {
  if (c.hideEmptyShuttle && !snap?.shuttle) return;
  const k = c.k;
  const w = 168;
  const x0 = DESIGN_W - 12 - w;
  const y0 = 10;
  const sh = snap?.shuttle;
  shape(c, 10, a, b, roundRect(w * k, 74 * k, 12 * k), { x: x0 * k, y: y0 * k }, BACK, 0.84);
  label(c, 11, a, b, 'SHUTTLE SPEED', { x: (x0 + 12) * k, y: (y0 + 8) * k }, 10, SOFT, { bold: true, spacing: 1 });
  label(c, 11, a, b, sh ? `~${sh.speedKmh}` : '–', { x: (x0 + 12) * k, y: (y0 + 22) * k }, 28, '#FFFFFF', { bold: true });
  label(c, 11, a, b, 'km/h', { x: (x0 + w - 12) * k, y: (y0 + 36) * k }, 12, LIME, { bold: true, anchor: 9 });
  label(c, 11, a, b, sh ? 'LAST SHOT · ESTIMATE' : 'NEEDS SHUTTLE TRACKING', { x: (x0 + 12) * k, y: (y0 + 58) * k }, 10, MUTED);
  const y1 = y0 + 80;
  shape(c, 10, a, b, roundRect(w * k, 94 * k, 12 * k), { x: x0 * k, y: y1 * k }, BACK, 0.84);
  label(c, 11, a, b, 'SHOTS THIS RALLY', { x: (x0 + 12) * k, y: (y1 + 8) * k }, 10, SOFT, { bold: true, spacing: 1 });
  label(c, 11, a, b, sh ? String(sh.shots).padStart(2, '0') : '–', { x: (x0 + 12) * k, y: (y1 + 22) * k }, 28, '#FFFFFF', { bold: true });
  if (sh?.lastShot) {
    label(c, 11, a, b, sh.lastShot.type, { x: (x0 + 12) * k, y: (y1 + 58) * k }, 14, LIME, { bold: true });
    label(c, 11, a, b, `${sh.lastShot.player} · shot ${sh.lastShot.number}`.toUpperCase(), { x: (x0 + 12) * k, y: (y1 + 76) * k }, 10, MUTED);
  }
}

function courtMapStatic(c: Ctx, end: number) {
  const k = c.k;
  const x0 = 12;
  const y0 = 10;
  shape(c, 10, 0, end, roundRect(104 * k, 150 * k, 12 * k), { x: x0 * k, y: y0 * k }, BACK, 0.84);
  label(c, 11, 0, end, 'COURT MAP', { x: (x0 + 8) * k, y: (y0 + 7) * k }, 10, SOFT, { bold: true, spacing: 1 });
  // top-down court, far end at the top: outer lines, singles side lines and centre line
  const mx = (u: number) => (x0 + 8 + (u * 88 * 68) / 80 + (6 * 88) / 80) * k;
  const my = (v: number) => (y0 + 22 + (4 + v * 100) * (119 / 108)) * k;
  const seg = (u1: number, v1: number, u2: number, v2: number) => {
    const [ax, ay, bx, by] = [mx(u1), my(v1), mx(u2), my(v2)];
    const thick = 1.2 * k;
    const [x, y] = [Math.min(ax, bx) - thick / 2, Math.min(ay, by) - thick / 2];
    const [w, h] = [Math.abs(bx - ax) + thick, Math.abs(by - ay) + thick];
    shape(c, 11, 0, end, `m 0 0 l ${n1(w)} 0 l ${n1(w)} ${n1(h)} l 0 ${n1(h)}`, { x, y }, '#6F8279', 1);
  };
  seg(0, 0, 1, 0); seg(0, 1, 1, 1); seg(0, 0, 0, 1); seg(1, 0, 1, 1); seg(0, 0.5, 1, 0.5);
}

function mapDots(c: Ctx, snap: OverlaySnapshot, colorOf: (p: number) => string, a: number, b: number) {
  const k = c.k;
  const x0 = 12;
  const y0 = 10;
  for (const t of snap.tracks) {
    if (t.lost) continue;
    const cx = (x0 + 8 + 6 * (88 / 80) + t.u * 68 * (88 / 80)) * k;
    const cy = (y0 + 22 + (4 + t.v * 100) * (119 / 108)) * k;
    const r = 4 * k;
    shape(c, 12, a, b, ellipse(r, r), { x: cx - r, y: cy - r }, colorOf(snap.assign[t.id] ?? t.id), 1);
  }
}

function distanceCard(c: Ctx, names: string[], colorOf: (p: number) => string, snap: OverlaySnapshot | undefined, a: number, b: number, canvasH: number) {
  const k = c.k;
  const w = 188;
  const h = 28 + names.length * 22;
  const x0 = 12;
  const y0 = canvasH - 12 - h;
  shape(c, 10, a, b, roundRect(w * k, h * k, 12 * k), { x: x0 * k, y: y0 * k }, BACK, 0.84);
  label(c, 11, a, b, 'DISTANCE COVERED', { x: (x0 + 8) * k, y: (y0 + 8) * k }, 10, SOFT, { bold: true, spacing: 1 });
  names.forEach((name, i) => {
    const y = y0 + 26 + i * 22;
    const d = snap?.dist[i];
    shape(c, 11, a, b, ellipse(4 * k, 4 * k), { x: (x0 + 8) * k, y: (y + 5) * k }, colorOf(i), 1);
    label(c, 11, a, b, name, { x: (x0 + 24) * k, y: y * k }, 13, '#FFFFFF');
    label(c, 11, a, b, d == null ? '–' : `~${Math.round(d)} m`, { x: (x0 + w - 8) * k, y: y * k }, 15, '#FFFFFF', { bold: true, anchor: 9 });
  });
}

/** Ring under each player's feet and a name tag above them, gliding to the next snapshot's position. */
function players(c: Ctx, seg: Seg, map: CourtMap, names: string[], colorOf: (p: number) => string) {
  const snap = seg.snap!;
  const k = c.k;
  for (const t of snap.tracks) {
    const p = snap.assign[t.id] ?? t.id;
    const color = colorOf(p);
    const nextT = seg.next?.tracks.find((x) => x.id === t.id);
    const place = (u: number, v: number) => {
      const foot = map.toScreen(u, v);
      const l = map.toScreen(u - 0.045, v);
      const r = map.toScreen(u + 0.045, v);
      return { foot, rx: Math.max(8 * k, Math.abs(r.x - l.x) / 2) };
    };
    const a = place(t.u, t.v);
    const b = nextT ? place(nextT.u, nextT.v) : a;
    const mv = nextT && !nextT.lost ? true : false;
    // ring (outline only)
    shape(c, 20, seg.start, seg.end, ellipse(a.rx, a.rx * 0.34), { x: a.foot.x - a.rx, y: a.foot.y - a.rx * 0.34 }, color, 0,
      { stroke: { width: 2.5 * k, color }, move: mv ? { to: { x: b.foot.x - b.rx, y: b.foot.y - b.rx * 0.34 } } : undefined });
    // name tag
    const name = names[p] ?? '';
    const tw = (name.length * 5.8 + 18) * k;
    const th = 22 * k;
    const topA = { x: a.foot.x - tw / 2, y: a.foot.y - a.rx * 2.6 - 24 * k };
    const topB = { x: b.foot.x - tw / 2, y: b.foot.y - b.rx * 2.6 - 24 * k };
    shape(c, 21, seg.start, seg.end, roundRect(tw, th, 6 * k), topA, BACK, 0.85, { move: mv ? { to: topB } : undefined });
    shape(c, 22, seg.start, seg.end, `m 0 0 l ${n1(4 * k)} 0 l ${n1(4 * k)} ${n1(th)} l 0 ${n1(th)}`, topA, color, 1, { move: mv ? { to: topB } : undefined });
    label(c, 23, seg.start, seg.end, name, { x: topA.x + tw / 2 + 2 * k, y: topA.y + 3 * k }, 12, '#FFFFFF', { bold: true, anchor: 8, move: mv ? { to: { x: topB.x + tw / 2 + 2 * k, y: topB.y + 3 * k } } : undefined });
  }
}

// --- entry point ----------------------------------------------------------------------------------------------

/** Everything to draw, in a 1920 wide space, from the overlay saved while recording. */
export function buildScene(input: AssInput): Scene {
  const { config, rallies, overlay, durationMs } = input;
  const resX = 1920;
  const resY = Math.round(resX / overlay.frameAspect);
  const k = resX / DESIGN_W;
  const canvasH = DESIGN_W / overlay.frameAspect;
  const c: Ctx = { k, items: [], hideEmptyShuttle: input.hideEmptyShuttle };
  const names = [...config.players.A, ...config.players.B];
  const nNear = config.players.A.length;
  const colorOf = (p: number) => (p < nNear ? NEAR[p] : FAR[p - nNear]);
  const stride = 1000 / (input.updatesPerSecond ?? 2);

  // Score: one stretch for every moment the score changed
  const edges = [0, ...rallies.map((r) => r.endMs ?? 0).filter((t) => t > 0 && t < durationMs), durationMs];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] > edges[i]) scoreboard(c, stateAt(config, rallies, edges[i]), edges[i], edges[i + 1]);
  }

  const segs = buildSegments(overlay.snapshots, durationMs, stride);

  // Shuttle cards and distance only redraw when their numbers change
  for (const m of merged(segs, (s) => s.snap?.shuttle ?? null)) shuttleCards(c, m.seg.snap, m.start, m.end);
  for (const m of merged(segs, (s) => s.snap?.dist ?? null)) distanceCard(c, names, colorOf, m.seg.snap, m.start, m.end, canvasH);

  // Court map: the court is drawn once, the dots follow the snapshots
  courtMapStatic(c, durationMs);
  const map = courtMap(cornersInBox(overlay.corners ?? { farLeft: { x: 0.3, y: 0.3 }, farRight: { x: 0.7, y: 0.3 }, nearRight: { x: 0.95, y: 0.8 }, nearLeft: { x: 0.05, y: 0.8 } }, resX, resY));
  for (const seg of segs) {
    if (!seg.snap) continue;
    mapDots(c, seg.snap, colorOf, seg.start, seg.end);
    players(c, seg, map, names, colorOf);
  }
  return { width: resX, height: resY, items: c.items };
}

/** Longer than any game: items of a live scene stay on screen until the next one replaces them. */
const LIVE_END = 1e9;

export interface LiveInput {
  config: MatchConfig;
  /** The game as it stands now. */
  state: MatchState;
  /** What the tracker reports right now, or undefined when nothing is tracked. */
  snapshot?: OverlaySnapshot;
  /** Court corners as fractions of the video frame. */
  corners: OverlayData['corners'];
  frameAspect: number;
  hideEmptyShuttle?: boolean;
}

/**
 * The overlay for this moment only. The phone's camera code draws it onto every recorded frame until the next one arrives,
 * so the finished video has the overlay in it with no extra step. It uses the same drawing code as the exported scene.
 */
export function buildLiveScene(input: LiveInput): Scene {
  const resX = 1920;
  const resY = Math.round(resX / input.frameAspect);
  const k = resX / DESIGN_W;
  const canvasH = DESIGN_W / input.frameAspect;
  const c: Ctx = { k, items: [], hideEmptyShuttle: input.hideEmptyShuttle };
  const { config, state, snapshot } = input;
  const names = [...config.players.A, ...config.players.B];
  const nNear = config.players.A.length;
  const colorOf = (p: number) => (p < nNear ? NEAR[p] : FAR[p - nNear]);

  scoreboard(c, state, 0, LIVE_END);
  shuttleCards(c, snapshot, 0, LIVE_END);
  distanceCard(c, names, colorOf, snapshot, 0, LIVE_END, canvasH);
  courtMapStatic(c, LIVE_END);
  if (snapshot) {
    const map = courtMap(cornersInBox(input.corners ?? { farLeft: { x: 0.3, y: 0.3 }, farRight: { x: 0.7, y: 0.3 }, nearRight: { x: 0.95, y: 0.8 }, nearLeft: { x: 0.05, y: 0.8 } }, resX, resY));
    mapDots(c, snapshot, colorOf, 0, LIVE_END);
    players(c, { start: 0, end: LIVE_END, snap: snapshot }, map, names, colorOf);
  }
  return { width: resX, height: resY, items: c.items };
}

/** Writes a scene as an ASS subtitle file. */
export function sceneToAss(scene: Scene, fontName = 'Arial'): string {
  const lines: string[] = [];
  for (const it of scene.items) {
    const place = it.mx !== undefined && it.my !== undefined ? `\\move(${it.x},${it.y},${it.mx},${it.my})` : `\\pos(${it.x},${it.y})`;
    let text: string;
    if (it.k === 's') {
      const stroke = it.sw ? `\\bord${it.sw}\\3c${assColor(it.sc ?? it.c)}` : '\\bord0';
      text = `{\\an7${place}${stroke}\\shad0\\1c${assColor(it.c)}\\1a${assAlpha(it.o)}\\p1}${it.d}{\\p0}`;
    } else {
      text = `{\\an${it.an}${place}\\fn${fontName}\\fs${it.z}\\b${it.w}\\fsp${it.sp}\\bord0\\shad0\\1c${assColor(it.c)}}${it.s}`;
    }
    lines.push(`Dialogue: ${it.l},${assTime(it.a)},${assTime(it.b)},Default,,0,0,0,,${text}`);
  }
  const header = [
    '[Script Info]',
    'Title: RallyCam overlay',
    'ScriptType: v4.00+',
    `PlayResX: ${scene.width}`,
    `PlayResY: ${scene.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},27,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  return [...header, ...lines].join('\n') + '\n';
}

export const buildAss = (input: AssInput): string => sceneToAss(buildScene(input), input.fontName);
