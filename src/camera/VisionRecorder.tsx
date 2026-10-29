import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Camera, CommonResolutions, useVideoOutput, type Recorder } from 'react-native-vision-camera';
import type { RecorderHandle, RecorderProps } from './types';

/** Target frame rate. The shuttle moves too fast for 30 fps. The camera falls back if the phone cannot do this. */
export const TARGET_FPS = 120;

const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

/** Recording with react-native-vision-camera: high frame rate, no video stabilisation. Needs a development build. */
const VisionRecorder = forwardRef<RecorderHandle, RecorderProps>(function VisionRecorder({ style, onReady, onError, onFps }, ref) {
  const video = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: true });
  const recorder = useRef<Recorder | null>(null);
  const finished = useRef<((uri?: string) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    async start() {
      const r = await video.createRecorder({});
      recorder.current = r;
      await r.startRecording(
        (path) => finished.current?.(toUri(path)),
        (e) => { onError(e.message); finished.current?.(undefined); },
      );
    },
    async stop() {
      const r = recorder.current;
      if (!r) return undefined;
      const done = new Promise<string | undefined>((resolve) => { finished.current = resolve; });
      await r.stopRecording();
      return done;
    },
  }), [video, onError]);

  return (
    <Camera
      style={style}
      device="back"
      isActive
      outputs={[video]}
      // Earlier constraints matter more. Stabilisation off keeps the court in the same place in every frame.
      constraints={[{ fps: TARGET_FPS }, { videoStabilizationMode: 'off' }]}
      onSessionConfigSelected={(c) => onFps(c.selectedFPS)}
      onStarted={onReady}
      onError={(e) => onError(e.message)}
    />
  );
});

export default VisionRecorder;
