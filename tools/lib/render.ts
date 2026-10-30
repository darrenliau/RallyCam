import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ellipse, sceneToAss, type Scene, type SceneItem } from '../../src/export/ass';
import { H, W } from './clip';

export interface DrawFrame {
  t: number;
  boxes: { x: number; y: number }[];
  /** RallyCam's tracker: a yellow ring and a SHUTTLE tag. */
  track?: { x: number; y: number };
  /** Another tracker to compare (TrackNet): a cyan ring and a tag. */
  other?: { x: number; y: number };
}

/** Writes a copy of the clip with what the tracker saw drawn on it, through an ASS subtitle file (like tools/burn-overlay.sh). */
export function renderOverlay(file: string, to: string, frames: DrawFrame[]): Promise<void> {
  const items: SceneItem[] = [];
  const ms = (t: number) => Math.round(t * 1000);
  for (const r of frames) {
    const a = ms(r.t);
    const b = ms(r.t + 1 / 60);
    for (const c of r.boxes) {
      items.push({ k: 's', l: 1, a, b, x: c.x - 4, y: c.y - 4, d: 'm 0 0 l 8 0 l 8 8 l 0 8', c: '#FFFFFF', o: 0, sw: 1.5, sc: '#FFFFFF' });
    }
    const mark = (p: { x: number; y: number }, color: string, name: string, up: number) => {
      items.push({ k: 's', l: 3, a, b, x: p.x - 16, y: p.y - 16, d: ellipse(16, 16), c: color, o: 0, sw: 3, sc: color });
      items.push({ k: 's', l: 4, a, b, x: p.x - 50, y: p.y - up, d: 'm 0 0 l 100 0 l 100 22 l 0 22', c: '#05090A', o: 0.85 });
      items.push({ k: 't', l: 5, a, b, x: p.x, y: p.y - up + 3, s: name, z: 16, w: 1, an: 8, c: '#FFFFFF', sp: 0 });
    };
    if (r.track) mark(r.track, '#FFD166', 'RALLYCAM', 56);
    if (r.other) mark(r.other, '#22D3EE', 'TRACKNET', 84);
  }
  const scene: Scene = { width: W, height: H, items };
  const assFile = join(tmpdir(), `replay-${process.pid}.ass`);
  writeFileSync(assFile, sceneToAss(scene));
  // the subtitles filter wants colons and backslashes escaped in the path
  const escaped = assFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  return new Promise((resolve) => {
    const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `subtitles='${escaped}'`, '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'copy', to], { stdio: 'inherit' });
    enc.on('close', (code) => {
      console.log(code === 0 ? `Wrote ${to}` : `ffmpeg failed (${code}). Does your ffmpeg have subtitle support (libass)?`);
      resolve();
    });
  });
}
