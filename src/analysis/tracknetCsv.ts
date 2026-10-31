import type { FrameResult } from './shuttleEval';

/**
 * Reads TrackNetV3's prediction file (Frame,Visibility,X,Y, one row per video frame, positions in video pixels) into
 * per-frame results, so it can be scored with the same labels and numbers as RallyCam's own tracker.
 */
/**
 * InpaintNet, TrackNet's second stage, fills every gap, so the CSV can say "seen" for every frame. When the shuttle is out of
 * the picture or hidden it often repeats one position. Runs of this many identical positions are those fill-ins, not detections.
 */
export const STUCK_FRAMES = 5;

export function parseTracknetCsv(text: string, fps: number, frameCount?: number, dropStuck = true): FrameResult[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [cf, cv, cx, cy] = [col('frame'), col('visibility'), col('x'), col('y')];
  if (cf < 0 || cx < 0 || cy < 0) throw new Error('Not a TrackNet CSV: expected Frame, Visibility, X, Y columns');
  const byFrame = new Map<number, { x: number; y: number }>();
  let last = 0;
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const frame = Math.round(Number(f[cf]));
    last = Math.max(last, frame);
    const visible = cv < 0 ? true : Number(f[cv]) === 1;
    const x = Number(f[cx]);
    const y = Number(f[cy]);
    if (visible && Number.isFinite(x) && Number.isFinite(y) && !(x === 0 && y === 0)) byFrame.set(frame, { x, y });
  }
  if (dropStuck) {
    let run: number[] = [];
    const flush = () => { if (run.length >= STUCK_FRAMES) run.forEach((f) => byFrame.delete(f)); run = []; };
    for (let f = 0; f <= last; f++) {
      const p = byFrame.get(f);
      const q = run.length ? byFrame.get(run[run.length - 1]) : undefined;
      if (p && q && p.x === q.x && p.y === q.y) run.push(f);
      else { flush(); if (p) run = [f]; }
    }
    flush();
  }
  const n = frameCount ?? last + 1;
  return Array.from({ length: n }, (_, i) => {
    const p = byFrame.get(i);
    return { t: i / fps, boxes: p ? [p] : [], ...(p ? { track: p } : {}) };
  });
}
