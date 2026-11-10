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

/** What the shuttle model saw in a window of 8 frames in a row: positions are fractions of the camera frame, missing when nothing was seen. */
export interface ShuttleModelEvent {
  frames: { t: number; x?: number; y?: number }[];
  predictMs: number;
}

export interface ShuttleModelStatus {
  /** missing: the model file is not in this build. failed: it could not be loaded or run (see problem). */
  state: 'off' | 'loading' | 'ready' | 'missing' | 'failed';
  problem: string;
  enabled: boolean;
  framesSeen: number;
  framesDropped: number;
  windows: number;
  windowsDropped: number;
  detections: number;
  predictMs: number;
}

type Events = {
  onDetections: (e: { boxes: CaptureBox[] }) => void;
  onError: (e: { message: string }) => void;
  onInterruption: (e: { interrupted: boolean; reason: string }) => void;
  onPressure: (e: { level: string }) => void;
  onShuttle: (e: ShuttleEvent) => void;
  onShuttleModel: (e: ShuttleModelEvent) => void;
  /** Body poses of the players nearest the shuttle (see src/analysis/pose.ts decodePose). */
  onPose: (e: { poses: { t: number; x: number; y: number; w: number; h: number; kp: number[] }[] }) => void;
  /** A button pressed on the Apple Watch app. */
  onWatchCommand: (e: { command?: string; side?: string }) => void;
};

declare class RallyCamCaptureModule extends NativeModule<Events> {
  startSession(targetFps: number, lens: string): Promise<{ fps: number; width: number; height: number; lens: string; framing?: 'off' | 'crop' }>;
  getLenses(): string[];
  /** What auto-framing the phone can do (only in builds that have it): the most frames a second at 4K on the ultra-wide camera (0 = no 4K), and whether a camera joining the ultra-wide and wide lenses exists. */
  getFramingSupport?(): { cropFps: number; lens: boolean };
  setLens(lens: string, targetFps: number): Promise<{ fps: number; width: number; height: number; lens: string }>;
  stopSession(): Promise<void>;
  /** `analysisUri`, when given, gets a second file with a clean (no overlay) 960 wide copy of the picture, for analysing the game afterwards. */
  startRecording(uri: string, outputFps: number, width: number, height: number, bitRate: number, analysisUri: string | null): void;
  /** `analysisUri` is null when no clean copy was asked for or it could not be made. */
  stopRecording(): Promise<{ uri: string | null; analysisUri: string | null }>;
  setOverlay(json: string): void;
  getStatus(): { overlayPushes: number; overlayDecoded: number; overlayFailed: number; framesWritten: number; framesWithOverlay: number; lastProblem: string; lens: string; running: boolean; framesIn: number; luma: number; audioBuffers: number; audioLevel: number; audioInFile: boolean; device: string; exposureMs: number; iso: number; interrupted: boolean };
  setDetection(enabled: boolean, x: number, y: number, w: number, h: number): void;
  setShuttle(enabled: boolean, x: number, y: number, w: number, h: number): void;
  /** The next camera frame as a grey picture, shrunk by a whole number to about `maxWidth` pixels wide: { width, height, data: base64 of one byte per pixel }. For finding the court lines. */
  grabStill(maxWidth: number): Promise<{ width: number; height: number; data: string }>;
  /** TrackNetV3 on the Neural Engine. Needs the model file in the build (ios/Models/README.md). Positions arrive with onShuttleModel. */
  /** Looks for body poses on the players nearest the shuttle. */
  setPose(enabled: boolean): void;
  /** Where the shuttle is, in frame fractions, so the nearest players are looked at. NaN when not seen. */
  setPoseFocus(x: number, y: number): void;
  /**
   * Auto-framing (only in builds that have it). `crop`: the saved video and the preview show a window of the full 4K picture; `lens`: the
   * camera zooms. cx, cy, w are the wanted window in the full picture (see src/analysis/framing.ts).
   */
  /** Before startSession: the auto-framing mode wanted. The camera may settle on 'off' (the startSession result says). */
  setFramingMode?(mode: 'off' | 'crop' | 'lens'): void;
  setFramingTarget?(mode: 'crop' | 'lens', cx: number, cy: number, w: number): void;
  setShuttleModel(enabled: boolean): void;
  getShuttleModelStatus(): ShuttleModelStatus;
  /** Gives the shuttle model only this part of the frame (fractions, origin top left, 16:9 in pixels), or the whole frame when all are 0. Reported positions stay fractions of the whole frame. */
  setShuttleModelCrop(x: number, y: number, w: number, h: number): void;
  /** While true the model looks at the whole frame even when a crop is set (its crop picture is kept ready). */
  setShuttleModelFull(full: boolean): void;
  /** Sends the watch app a small picture of the camera a few times a second while on. */
  setWatchPreview(on: boolean): void;
  /** The state of the game for the watch app, as JSON text (see src/watchBridge.ts). */
  sendWatchState(json: string): void;
  /** Is a watch paired, has it the app, and can it be reached right now. */
  getWatchStatus(): { supported: boolean; paired?: boolean; installed?: boolean; reachable?: boolean };
  startShuttleLog(uri: string): void;
  stopShuttleLog(): void;
  getShuttleStatus(): { shuttleFrames: number; shuttleWithCandidates: number; shuttleConfirmed: number; shuttleShaky: number; shuttleLastCandidates: number };
}

/** null in Expo Go, on Android, and in builds made before this module existed. */
export const Capture = requireOptionalNativeModule<RallyCamCaptureModule>('RallyCamCapture');

/** The camera preview. Only call this when `Capture` is not null. */
export const CapturePreview: ComponentType<ViewProps> | null = Capture ? requireNativeView<ViewProps>('RallyCamCapture') : null;
