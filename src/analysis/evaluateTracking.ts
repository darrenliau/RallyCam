import { courtMap, type Corners } from './court';
import type { Detection } from './detector';
import { DistanceMeter, type Track } from './players';
import { PlayerTrackerCore, type FrameGeometry } from './tracker';

/** Everything here is plain TypeScript so it can be tested and also run from tools/evaluate-tracking.ts. */

export interface DetectionRow { frame: number; det: Detection }
export interface GroundTruthRow { frame: number; id: number; x: number; y: number }
export interface Meta { width: number; height: number; fps: number; totalFrames: number; frameStep: number }

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Columns: frame,time_s,x,y,w,h,score. Box values are fractions of the video frame. */
export function parseDetectionsCsv(text: string): DetectionRow[] {
  return lines(text).slice(1).map((l) => {
    const [frame, , x, y, w, h, score] = l.split(',').map(Number);
    return { frame, det: { x, y, w, h, score } };
  });
}

/** Columns: frame,id,x,y. Hand-labelled foot positions in video pixels, id = the player's tracker id. */
export function parseGroundTruthCsv(text: string): GroundTruthRow[] {
  return lines(text).slice(1).map((l) => {
    const [frame, id, x, y] = l.split(',').map(Number);
    return { frame, id, x, y };
  });
}

/** The court file from the labelling spec: pixel positions of the four outer doubles-court corners. */
export function parseCourtJson(j: Record<string, [number, number]>): Corners {
  const pt = (k: string) => {
    const v = j[k];
    if (!v) throw new Error(`court file is missing "${k}"`);
    return { x: v[0], y: v[1] };
  };
  return { nearLeft: pt('near_left'), nearRight: pt('near_right'), farRight: pt('far_right'), farLeft: pt('far_left') };
}

export interface EvalOptions {
  nNear: number;
  nFar: number;
  /** Subsample to this many analysed frames per second, like the phone would. Default: use every sampled frame. */
  analysisFps?: number;
  /** A player moving further than this between two analysed frames counts as a jump (likely an identity swap). */
  jumpMetres?: number;
  minScore?: number;
}

export interface EvalResult {
  framesAnalysed: number;
  analysisFps: number;
  meanDetectionsPerFrame: number;
  /** Share of frames where every expected player was seen in that very frame. */
  allPlayersSeen: number;
  perPlayer: { id: number; seen: number; longestGapSeconds: number; metres: number; jumps: number }[];
  jumps: number;
  groundTruth?: { labelled: number; missed: number; medianErrorCm: number; p90ErrorCm: number; idCorrect: number };
}

export function evaluateTracking(
  rows: DetectionRow[], meta: Meta, corners: Corners, o: EvalOptions, gt?: GroundTruthRow[],
): { result: EvalResult; tracksCsv: string } {
  const n = o.nNear + o.nFar;
  const minScore = o.minScore ?? 0.4;
  const jumpMetres = o.jumpMetres ?? 1.5;
  const map = courtMap(corners);
  const geometry: FrameGeometry = { frameAspect: meta.width / meta.height, screenW: meta.width, screenH: meta.height };
  const core = new PlayerTrackerCore({ nNear: o.nNear, nFar: o.nFar, minScore });
  const meter = new DistanceMeter();

  const byFrame = new Map<number, Detection[]>();
  for (const r of rows) {
    const list = byFrame.get(r.frame);
    if (list) list.push(r.det);
    else byFrame.set(r.frame, [r.det]);
  }

  const minDt = o.analysisFps ? 1 / o.analysisFps : 0;
  let lastT = -Infinity;
  let analysed = 0;
  let detTotal = 0;
  let allSeen = 0;
  let jumps = 0;
  const seen = new Array(n).fill(0);
  const gap = new Array(n).fill(0);
  const longestGap = new Array(n).fill(0);
  const jumpsPer = new Array(n).fill(0);
  const prev = new Map<number, { u: number; v: number }>();
  const tracksByFrame = new Map<number, Track[]>();
  const csv: string[] = ['frame,id,u,v,lost'];

  for (let f = 0; f < meta.totalFrames; f += meta.frameStep) {
    const t = f / meta.fps;
    if (t - lastT < minDt - 1e-9) continue;
    lastT = t;
    const dets = byFrame.get(f) ?? [];
    detTotal += dets.filter((d) => d.score >= minScore).length;
    const tracks = core.update(dets, map, geometry);
    analysed++;
    meter.update(tracks, (id) => id);
    if (gt) tracksByFrame.set(f, tracks);

    const live = new Set(tracks.filter((x) => !x.lost).map((x) => x.id));
    if (live.size === n) allSeen++;
    for (let id = 0; id < n; id++) {
      if (live.has(id)) { seen[id]++; gap[id] = 0; } else { gap[id]++; longestGap[id] = Math.max(longestGap[id], gap[id]); }
    }
    for (const tr of tracks) {
      csv.push(`${f},${tr.id},${tr.u.toFixed(4)},${tr.v.toFixed(4)},${tr.lost ?? 0}`);
      const p = prev.get(tr.id);
      if (p && Math.hypot((tr.u - p.u) * 6.1, (tr.v - p.v) * 13.4) > jumpMetres) { jumps++; jumpsPer[tr.id]++; }
      prev.set(tr.id, { u: tr.u, v: tr.v });
    }
  }

  const dt = analysed ? meta.totalFrames / meta.fps / analysed : 0; // seconds between analysed frames
  const result: EvalResult = {
    framesAnalysed: analysed,
    analysisFps: analysed > 1 ? analysed / (meta.totalFrames / meta.fps) : 0,
    meanDetectionsPerFrame: analysed ? detTotal / analysed : 0,
    allPlayersSeen: analysed ? allSeen / analysed : 0,
    perPlayer: Array.from({ length: n }, (_, id) => ({
      id, seen: analysed ? seen[id] / analysed : 0, longestGapSeconds: longestGap[id] * dt, metres: meter.metres(id), jumps: jumpsPer[id],
    })),
    jumps,
  };

  if (gt && gt.length) {
    const frames = [...tracksByFrame.keys()];
    const errs: number[] = [];
    let missed = 0;
    let idOk = 0;
    for (const row of gt) {
      const f = frames.reduce((best, x) => (Math.abs(x - row.frame) < Math.abs(best - row.frame) ? x : best), frames[0]);
      const tracks = tracksByFrame.get(f) ?? [];
      const c = map.toCourt({ x: row.x, y: row.y });
      const mine = tracks.find((x) => x.id === row.id && !x.lost);
      const nearest = tracks.reduce<{ id: number; d: number } | null>((b, x) => {
        const d = Math.hypot((x.u - c.u) * 6.1, (x.v - c.v) * 13.4);
        return !b || d < b.d ? { id: x.id, d } : b;
      }, null);
      if (!mine) { missed++; continue; }
      errs.push(100 * Math.hypot((mine.u - c.u) * 6.1, (mine.v - c.v) * 13.4));
      if (nearest?.id === row.id) idOk++;
    }
    errs.sort((a, b) => a - b);
    result.groundTruth = {
      labelled: gt.length,
      missed,
      medianErrorCm: errs.length ? errs[Math.floor((errs.length - 1) / 2)] : NaN,
      p90ErrorCm: errs.length ? errs[Math.floor((errs.length - 1) * 0.9)] : NaN,
      idCorrect: errs.length ? idOk / errs.length : NaN,
    };
  }
  return { result, tracksCsv: csv.join('\n') + '\n' };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatReport(r: EvalResult): string {
  const band = r.allPlayersSeen >= 0.9 ? 'good' : r.allPlayersSeen >= 0.75 ? 'marginal' : 'poor';
  const out = [
    `frames analysed          : ${r.framesAnalysed} (about ${r.analysisFps.toFixed(1)} per second)`,
    `people found per frame   : ${r.meanDetectionsPerFrame.toFixed(2)}`,
    `all players seen         : ${pct(r.allPlayersSeen)}   (${band}: good >= 90%, marginal 75-90%)`,
  ];
  for (const p of r.perPlayer) {
    out.push(`  player ${p.id}: seen ${pct(p.seen)}, longest gap ${p.longestGapSeconds.toFixed(1)} s, moved ~${p.metres.toFixed(0)} m, ${p.jumps} jumps`);
  }
  out.push(`jumps (possible id swaps): ${r.jumps}`);
  if (r.groundTruth) {
    const g = r.groundTruth;
    out.push(`labelled positions       : ${g.labelled}, missed ${g.missed}`);
    out.push(`foot position error      : median ${g.medianErrorCm.toFixed(0)} cm, 90th percentile ${g.p90ErrorCm.toFixed(0)} cm`);
    out.push(`id matches nearest label : ${pct(g.idCorrect)}`);
  }
  return out.join('\n');
}
