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
  /** Average colour of the torso as [luma, blue chroma, red chroma], 0..255. Helps tell players apart when they cross. */
  look?: [number, number, number];
}

/**
 * Finds people in the live camera frames. The real one runs in the camera component (src/camera/VisionRecorder.tsx),
 * so it is kept separate from the tracking logic in tracker.ts, which is plain TypeScript and tested.
 * `onDetections` is called once per analysed frame, with an empty array when nobody was found.
 */
export interface PersonDetector {
  start(onDetections: (detections: Detection[]) => void): void;
  stop(): void;
}

/**
 * Lets the camera component hand detections to the tracker without the tracker knowing about React.
 * The camera calls `emit` for every analysed frame, and `DetectorPlayerTracker` listens through `start`.
 */
export class DetectionBridge implements PersonDetector {
  private listener: ((detections: Detection[]) => void) | null = null;

  start(onDetections: (detections: Detection[]) => void) {
    this.listener = onDetections;
  }

  stop() {
    this.listener = null;
  }

  emit = (detections: Detection[]) => {
    this.listener?.(detections);
  };
}

/** Aspect ratio (width / height) of the landscape camera frame the detector sees. */
export const FRAME_ASPECT = 16 / 9;
