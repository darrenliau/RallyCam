import type { FrameResult } from './shuttleEval';

/**
 * Reads TrackNetV3's prediction file (Frame,Visibility,X,Y, one row per video frame, positions in video pixels) into
 * per-frame results, so it can be scored with the same labels and numbers as RallyCam's own tracker.
 */
export function parseTracknetCsv(text: string, fps: number, frameCount?: number): FrameResult[] {
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
  const n = frameCount ?? last + 1;
  return Array.from({ length: n }, (_, i) => {
    const p = byFrame.get(i);
    return { t: i / fps, boxes: p ? [p] : [], ...(p ? { track: p } : {}) };
  });
}
