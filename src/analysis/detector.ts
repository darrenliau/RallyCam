/**
 * One person found in one camera frame. Box coordinates are fractions of the camera frame
 * (0..1, origin top left, frame in landscape orientation), so they do not depend on screen size.
 */
export interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detector confidence, 0..1. */
  score: number;
}

/**
 * Finds people in the live camera frames. This is the one piece that needs native code and a model,
 * so it is separate from the tracking logic in tracker.ts, which is plain TypeScript and tested.
 * `onDetections` is called once per analysed frame, with an empty array when nobody was found.
 */
export interface PersonDetector {
  start(onDetections: (detections: Detection[]) => void): void;
  stop(): void;
}

/**
 * Set this to a factory for the native detector once it exists. The Record screen starts player
 * tracking automatically when it is set. While it is null, only the debug simulator is available.
 */
export const personDetector: (() => PersonDetector) | null = null;

/** Aspect ratio (width / height) of the landscape camera frame the detector sees. */
export const FRAME_ASPECT = 16 / 9;
