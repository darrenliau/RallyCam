import { NativeModule, requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export interface CaptureBox { x: number; y: number; w: number; h: number; score: number }

type Events = {
  onDetections: (e: { boxes: CaptureBox[] }) => void;
  onError: (e: { message: string }) => void;
};

declare class RallyCamCaptureModule extends NativeModule<Events> {
  startSession(targetFps: number): Promise<{ fps: number; width: number; height: number }>;
  stopSession(): Promise<void>;
  startRecording(uri: string, outputFps: number): void;
  stopRecording(): Promise<string | null>;
  setOverlay(json: string): void;
  getStatus(): { overlayPushes: number; overlayDecoded: number; overlayFailed: number; framesWritten: number; framesWithOverlay: number; lastProblem: string; lens: string; running: boolean; framesIn: number };
  setDetection(enabled: boolean, x: number, y: number, w: number, h: number): void;
}

/** null in Expo Go, on Android, and in builds made before this module existed. */
export const Capture = requireOptionalNativeModule<RallyCamCaptureModule>('RallyCamCapture');

/** The camera preview. Only call this when `Capture` is not null. */
export const CapturePreview: ComponentType<ViewProps> | null = Capture ? requireNativeView<ViewProps>('RallyCamCapture') : null;
