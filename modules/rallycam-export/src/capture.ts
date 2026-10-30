import { NativeModule, requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export interface CaptureBox { x: number; y: number; w: number; h: number; score: number; ly?: number; lcb?: number; lcr?: number }

/** What the experimental shuttle tracker reports. Positions are fractions of the camera frame. */
export interface ShuttleEvent {
  t: number;
  candidates: number;
  shaky: boolean;
  /** Present while a track is confirmed. */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  misses?: number;
  tTrack?: number;
}

type Events = {
  onDetections: (e: { boxes: CaptureBox[] }) => void;
  onError: (e: { message: string }) => void;
  onInterruption: (e: { interrupted: boolean; reason: string }) => void;
  onPressure: (e: { level: string }) => void;
  onShuttle: (e: ShuttleEvent) => void;
};

declare class RallyCamCaptureModule extends NativeModule<Events> {
  startSession(targetFps: number): Promise<{ fps: number; width: number; height: number }>;
  stopSession(): Promise<void>;
  startRecording(uri: string, outputFps: number, width: number, height: number, bitRate: number): void;
  stopRecording(): Promise<string | null>;
  setOverlay(json: string): void;
  getStatus(): { overlayPushes: number; overlayDecoded: number; overlayFailed: number; framesWritten: number; framesWithOverlay: number; lastProblem: string; lens: string; running: boolean; framesIn: number; luma: number; audioBuffers: number; audioLevel: number; audioInFile: boolean; device: string; exposureMs: number; iso: number; interrupted: boolean };
  setDetection(enabled: boolean, x: number, y: number, w: number, h: number): void;
  setShuttle(enabled: boolean, x: number, y: number, w: number, h: number): void;
  startShuttleLog(uri: string): void;
  stopShuttleLog(): void;
  getShuttleStatus(): { shuttleFrames: number; shuttleWithCandidates: number; shuttleConfirmed: number; shuttleShaky: number; shuttleLastCandidates: number };
}

/** null in Expo Go, on Android, and in builds made before this module existed. */
export const Capture = requireOptionalNativeModule<RallyCamCaptureModule>('RallyCamCapture');

/** The camera preview. Only call this when `Capture` is not null. */
export const CapturePreview: ComponentType<ViewProps> | null = Capture ? requireNativeView<ViewProps>('RallyCamCapture') : null;
