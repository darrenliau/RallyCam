import type { Corners, Pt } from './court';
import type { Detection } from './detector';
import type { FrameGeometry } from './tracker';

/**
 * Pure helpers for turning a camera frame into model input and model output into detections.
 * Functions the frame callback calls carry a 'worklet' directive so they can run on the camera thread.
 */

/** A rectangle in the camera frame, as fractions of the frame (0..1, origin top left). */
export interface Roi { x: number; y: number; w: number; h: number }

/** The inverse of footToScreen: a point on the screen, as a fraction of the camera frame ("cover" fit). */
export function screenToFrame(p: Pt, g: FrameGeometry): { x: number; y: number } {
  const scale = Math.max(g.screenW / g.frameAspect, g.screenH);
  const ox = (g.screenW - g.frameAspect * scale) / 2;
  const oy = (g.screenH - scale) / 2;
  return { x: (p.x - ox) / (g.frameAspect * scale), y: (p.y - oy) / scale };
}

/**
 * The part of the camera frame worth analysing: the court plus room for the players' bodies above the far
 * lines and feet below the near line. Looking only at this region gives the model far more pixels per player.
 */
export function roiFromCorners(c: Corners, g: FrameGeometry): Roi {
  const pts = [c.farLeft, c.farRight, c.nearRight, c.nearLeft].map((p) => screenToFrame(p, g));
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const w = x1 - x0;
  const h = y1 - y0;
  const left = Math.max(0, x0 - 0.1 * w);
  const right = Math.min(1, x1 + 0.1 * w);
  const top = Math.max(0, y0 - 0.3 * h);
  const bottom = Math.min(1, y1 + 0.1 * h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A point in the camera frame, as a fraction of it, to the screen (the preview crops the frame to fill the screen). */
export function frameToScreen(p: { x: number; y: number }, g: FrameGeometry): Pt {
  const scale = Math.max(g.screenW / g.frameAspect, g.screenH);
  const ox = (g.screenW - g.frameAspect * scale) / 2;
  const oy = (g.screenH - scale) / 2;
  return { x: p.x * g.frameAspect * scale + ox, y: p.y * scale + oy };
}

/**
 * Where to look for the shuttle: the court area like roiFromCorners, but with much more room above, because the shuttle
 * flies high over the court.
 */
export function shuttleRoiFromCorners(c: Corners, g: FrameGeometry): Roi {
  const pts = [c.farLeft, c.farRight, c.nearRight, c.nearLeft].map((p) => screenToFrame(p, g));
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const w = x1 - x0;
  const h = y1 - y0;
  const left = Math.max(0, x0 - 0.06 * w);
  const right = Math.min(1, x1 + 0.06 * w);
  const top = Math.max(0, y0 - 0.9 * h);
  const bottom = Math.min(1, y1 + 0.05 * h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export interface RgbLayout { bytesPerPixel: number; r: number; g: number; b: number }

/** Where the red, green and blue bytes sit in a pixel for the frame formats vision-camera can deliver. */
export function rgbLayoutFor(pixelFormat: string, width: number, bytesPerRow: number): RgbLayout | null {
  'worklet';
  if (pixelFormat === 'rgb-bgra-8-bit') return { bytesPerPixel: 4, r: 2, g: 1, b: 0 };
  if (pixelFormat === 'rgb-rgba-8-bit') return { bytesPerPixel: 4, r: 0, g: 1, b: 2 };
  if (pixelFormat === 'rgb-rgb-8-bit') return { bytesPerPixel: bytesPerRow >= width * 4 ? 4 : 3, r: 0, g: 1, b: 2 };
  return null;
}

/**
 * Cuts the region of interest out of the frame and scales it to outW x outH RGB (nearest neighbour,
 * which is fast enough to run on every analysed frame). `out` is reused between frames when given.
 */
export function cropResizeRgb(
  src: Uint8Array, srcW: number, srcH: number, bytesPerRow: number, layout: RgbLayout,
  roi: Roi, outW: number, outH: number, out?: Uint8Array,
): Uint8Array {
  'worklet';
  const dst = out ?? new Uint8Array(outW * outH * 3);
  const x0 = roi.x * srcW;
  const y0 = roi.y * srcH;
  const sx = (roi.w * srcW) / outW;
  const sy = (roi.h * srcH) / outH;
  const { bytesPerPixel: bpp, r, g, b } = layout;
  let o = 0;
  for (let y = 0; y < outH; y++) {
    const row = Math.min(srcH - 1, Math.floor(y0 + (y + 0.5) * sy)) * bytesPerRow;
    for (let x = 0; x < outW; x++) {
      const i = row + Math.min(srcW - 1, Math.floor(x0 + (x + 0.5) * sx)) * bpp;
      dst[o++] = src[i + r];
      dst[o++] = src[i + g];
      dst[o++] = src[i + b];
    }
  }
  return dst;
}

/** Model class index for "person" (COCO, no background class). */
export const PERSON_CLASS = 0;

/**
 * Reads the model's four outputs and returns the people it found, with boxes expressed as fractions of the
 * whole camera frame (not just the region of interest). Boxes arrive as ymin, xmin, ymax, xmax.
 */
export function decodeDetections(
  boxes: Float32Array, classes: Float32Array, scores: Float32Array, count: number, roi: Roi, minScore: number,
): Detection[] {
  'worklet';
  const out: Detection[] = [];
  const n = Math.min(count, scores.length);
  for (let i = 0; i < n; i++) {
    if (classes[i] !== PERSON_CLASS || scores[i] < minScore) continue;
    const ymin = boxes[i * 4];
    const xmin = boxes[i * 4 + 1];
    const ymax = boxes[i * 4 + 2];
    const xmax = boxes[i * 4 + 3];
    out.push({
      x: roi.x + xmin * roi.w,
      y: roi.y + ymin * roi.h,
      w: (xmax - xmin) * roi.w,
      h: (ymax - ymin) * roi.h,
      score: scores[i],
    });
  }
  return out;
}
