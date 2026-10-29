import type { StyleProp, ViewStyle } from 'react-native';
import type { Detection } from '../analysis/detector';
import type { Roi } from '../analysis/preprocess';
import type { Scene } from '../export/ass';

export interface RecorderHandle {
  /** Starts recording to a file. Call after `onReady`. */
  start(): Promise<void>;
  /** Stops recording and resolves with the video file URI (undefined if nothing was recorded). */
  stop(): Promise<string | undefined>;
  /**
   * Only recorders that draw the overlay into the video while recording have this. Call it a few times a second
   * with the overlay for the current moment.
   */
  setOverlay?(scene: Scene): void;
  /** True when the file `stop()` returns already has the overlay drawn into it. */
  readonly bakesOverlay?: boolean;
}

/** Turn on person detection. Only the development and store builds support it, not Expo Go. */
export interface DetectionOptions {
  enabled: boolean;
  /** The part of the frame to analyse (the court plus headroom). Detection waits until this is known. */
  roi: Roi | null;
  onDetections: (detections: Detection[]) => void;
}

export interface RecorderProps {
  style?: StyleProp<ViewStyle>;
  onReady: () => void;
  onError: (message: string) => void;
  /** The frame rate the camera actually settled on. Can be lower than the 120 fps we ask for. */
  onFps: (fps: number | undefined) => void;
  detection?: DetectionOptions;
}
