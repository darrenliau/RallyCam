import type { StyleProp, ViewStyle } from 'react-native';

export interface RecorderHandle {
  /** Starts recording to a file. Call after `onReady`. */
  start(): Promise<void>;
  /** Stops recording and resolves with the video file URI (undefined if nothing was recorded). */
  stop(): Promise<string | undefined>;
}

export interface RecorderProps {
  style?: StyleProp<ViewStyle>;
  onReady: () => void;
  onError: (message: string) => void;
  /** The frame rate the camera actually settled on. Can be lower than the 120 fps we ask for. */
  onFps: (fps: number | undefined) => void;
}
