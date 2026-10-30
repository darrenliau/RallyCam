import type { StyleProp, ViewStyle } from 'react-native';
import type { Detection } from '../analysis/detector';
import type { Roi } from '../analysis/preprocess';
import type { Scene } from '../export/ass';

export interface RecorderHandle {
  /** Starts recording to a file. Call after `onReady`. Resolves with the file's uri when the camera knows it already. */
  start(): Promise<string | void>;
  /** Stops recording and resolves with the video file URI (undefined if nothing was recorded). */
  stop(): Promise<string | undefined>;
  /**
   * Only recorders that draw the overlay into the video while recording have this. Call it a few times a second
   * with the overlay for the current moment.
   */
  setOverlay?(scene: Scene): void;
  /** True when the file `stop()` returns already has the overlay drawn into it. */
  readonly bakesOverlay?: boolean;
  /** Only the iPhone camera can change lens. Not while recording. Resolves with the frame rate and lens now in use. */
  setLens?(lens: string): Promise<{ fps: number; lens: string }>;
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
  /** The camera was taken away (phone call, another app) or came back. Recording carries on by itself. */
  onInterruption?: (info: { interrupted: boolean; reason: string }) => void;
  /** How hot or strained the phone is: nominal, fair, serious, critical or shutdown. */
  onPressure?: (level: string) => void;
  /** The lens to start with ("auto", "ultra-wide", "wide" or "tele"). iPhone camera only. */
  lens?: string;
  /** Called when the camera starts and after every lens change, with the lens in use and the lenses the phone has. */
  onLens?: (info: { lens: string; available: string[] }) => void;
  detection?: DetectionOptions;
  /** Size, frame rate and bit rate of the saved video, for cameras that choose it. */
  videoProfile?: { fps: number; width: number; height: number; bitrate: number };
}
