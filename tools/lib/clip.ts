import { spawn } from 'node:child_process';
import { MotionShuttleTracker, type Box, type MotionOptions } from '../../src/analysis/shuttleMotion';
import type { FrameResult } from '../../src/analysis/shuttleEval';

export const W = 1920;
export const H = 1080;

/** RallyCam's own cards on a recorded video (top left, top right, bottom left), in pixels of the area from row y0 down. */
export function overlayCards(y0: number): Box[] {
  const h = H - y0;
  return [
    { x: 0, y: 0, w: 480, h: 460 - y0 },
    { x: 1480, y: 0, w: 440, h: 390 - y0 },
    { x: 0, y: 800 - y0, w: 520, h: H - 800 },
  ].filter((b) => b.h > 0).map((b) => ({ ...b, y: Math.max(0, b.y), h: Math.min(b.h, h) }));
}

export interface ClipRow extends FrameResult {
  cands: number;
  shaky: boolean;
  track?: { x: number; y: number; vx: number; vy: number; hits: number };
}

/** Decodes a clip with ffmpeg and runs the tracker over every frame. Positions come back in pixels of the full 1920 x 1080 frame. */
export function runClip(file: string, y0 = 300, options: Partial<MotionOptions> = {}, fps = 60): Promise<ClipRow[]> {
  const h = H - y0;
  const tracker = new MotionShuttleTracker(options);
  const cards = overlayCards(y0);
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=${W}:${h}:0:${y0},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const frameBytes = W * h;
    const rows: ClipRow[] = [];
    let buf = Buffer.alloc(0);
    let n = 0;
    ff.on('error', reject);
    ff.stdout.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= frameBytes) {
        const frame = new Uint8Array(buf.subarray(0, frameBytes));
        buf = buf.subarray(frameBytes);
        const t = n / fps;
        const r = tracker.update(frame, W, h, t, cards);
        rows.push({
          t,
          cands: r.candidates.length,
          shaky: r.shaky,
          boxes: r.candidates.map((c) => ({ x: c.x, y: c.y + y0 })),
          track: r.track && r.track.misses === 0 ? { x: r.track.x, y: r.track.y + y0, vx: r.track.vx, vy: r.track.vy, hits: r.track.hits } : undefined,
        });
        n++;
      }
    });
    ff.on('close', () => resolve(rows));
  });
}
