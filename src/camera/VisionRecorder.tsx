import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { Camera, CommonResolutions, useCameraDevice, useFrameOutput, useVideoOutput, type Frame, type Recorder } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import { cropResizeRgb, decodeDetections, rgbLayoutFor } from '../analysis/preprocess';
import type { RecorderHandle, RecorderProps } from './types';

/** Target frame rate. The shuttle moves too fast for 30 fps. The camera falls back if the phone cannot do this. */
export const TARGET_FPS = 120;

// Person detector settings. The camera delivers up to 120 frames a second, the detector looks at about 15.
const MODEL = require('../../assets/models/ssd_mobilenet_v2_coco_quant_postprocess.tflite');
const MODEL_SIZE = 300;
const MIN_INTERVAL_MS = 66;
const MIN_SCORE = 0.3;

const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

const sameShape = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Recording with react-native-vision-camera: high frame rate, no video stabilisation, and optional person
 * detection on a second output. Needs a development build.
 */
const VisionRecorder = forwardRef<RecorderHandle, RecorderProps>(function VisionRecorder({ style, onReady, onError, onFps, detection }, ref) {
  // The ultra-wide camera sees more of the court from close range. Phones without one use the main camera.
  const ultraWide = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle'] });
  const device = ultraWide?.type === 'ultra-wide-angle' ? ultraWide : 'back';
  const video = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: true });
  const recorder = useRef<Recorder | null>(null);
  const finished = useRef<((uri?: string) => void) | null>(null);

  // --- Person detection -------------------------------------------------------------------------------------
  const plugin = useTensorflowModel(MODEL, []);
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  const wantDetection = detection != null;
  const active = detection?.enabled === true && detection.roi != null && model != null;
  const roi = detection?.roi ?? null;
  const onDetections = detection?.onDetections;

  useEffect(() => {
    if (plugin.state === 'error') onError(`Person detector failed to load: ${plugin.error.message}`);
    if (!model) return;
    // The decoding in preprocess.ts assumes exactly this model contract (see assets/models/README.md).
    const input = model.inputs[0];
    const ok =
      input?.dataType === 'uint8' && sameShape(input.shape, [1, MODEL_SIZE, MODEL_SIZE, 3]) &&
      model.outputs.length === 4 &&
      sameShape(model.outputs[0].shape, [1, 20, 4]) && sameShape(model.outputs[1].shape, [1, 20]) &&
      sameShape(model.outputs[2].shape, [1, 20]) && sameShape(model.outputs[3].shape, [1]);
    if (!ok) onError('Person detector model has an unexpected input or output shape');
  }, [plugin, model, onError]);

  const onFrame = useCallback((frame: Frame) => {
    'worklet';
    try {
      if (!active || !model || !roi || !onDetections) return;
      const now = Date.now();
      const state = globalThis as unknown as { __rcLast?: number; __rcInput?: Uint8Array };
      if (now - (state.__rcLast ?? 0) < MIN_INTERVAL_MS) return;
      state.__rcLast = now;

      const layout = rgbLayoutFor(frame.pixelFormat, frame.width, frame.bytesPerRow);
      if (!layout || frame.orientation !== 'up' || frame.width < frame.height) {
        scheduleOnRN(onError, `Unsupported camera frame: ${frame.pixelFormat}, ${frame.width}x${frame.height}, ${frame.orientation}`);
        return;
      }
      const pixels = new Uint8Array(frame.getPixelBuffer());
      state.__rcInput ??= new Uint8Array(MODEL_SIZE * MODEL_SIZE * 3);
      const input = cropResizeRgb(pixels, frame.width, frame.height, frame.bytesPerRow, layout, roi, MODEL_SIZE, MODEL_SIZE, state.__rcInput);
      const out = model.runSync([input.buffer as ArrayBuffer]);
      const people = decodeDetections(new Float32Array(out[0]), new Float32Array(out[1]), new Float32Array(out[2]), new Float32Array(out[3])[0], roi, MIN_SCORE);
      scheduleOnRN(onDetections, people);
    } finally {
      frame.dispose(); // every frame must be released or the camera starts dropping frames
    }
  }, [active, model, roi, onDetections, onError]);

  // The frame output exists from the start so turning detection on never reconfigures the camera mid-recording.
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    enablePhysicalBufferRotation: true,
    dropFramesWhileBusy: true,
    onFrame,
    onFrameDropped: () => {},
  });

  // --- Recording --------------------------------------------------------------------------------------------
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
      device={device}
      isActive
      resizeMode="cover"
      outputs={wantDetection ? [video, frameOutput] : [video]}
      // Earlier constraints matter more. Stabilisation off keeps the court in the same place in every frame.
      constraints={[{ fps: TARGET_FPS }, { videoStabilizationMode: 'off' }]}
      onSessionConfigSelected={(c) => onFps(c.selectedFPS)}
      onStarted={onReady}
      onError={(e) => onError(e.message)}
    />
  );
});

export default VisionRecorder;
