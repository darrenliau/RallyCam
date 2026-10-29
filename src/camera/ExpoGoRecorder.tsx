import { CameraView } from 'expo-camera';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { RecorderHandle, RecorderProps } from './types';

/** Fallback for Expo Go, which cannot load vision-camera. Standard frame rate only. */
const ExpoGoRecorder = forwardRef<RecorderHandle, RecorderProps>(function ExpoGoRecorder({ style, onReady, onError, onFps }, ref) {
  const camera = useRef<CameraView>(null);
  const pending = useRef<Promise<{ uri: string } | undefined> | null>(null);

  useImperativeHandle(ref, () => ({
    async start() {
      pending.current = camera.current?.recordAsync().catch((e: Error) => { onError(e.message); return undefined; }) ?? null;
    },
    async stop() {
      camera.current?.stopRecording();
      return (await pending.current)?.uri;
    },
  }), [onError]);

  return (
    <CameraView
      ref={camera}
      style={style}
      mode="video"
      facing="back"
      onCameraReady={() => { onFps(undefined); onReady(); }}
    />
  );
});

export default ExpoGoRecorder;
