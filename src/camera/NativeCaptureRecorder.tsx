import { newAnalysisVideoFile, newGameVideoFile } from '../export/storage';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Capture, CapturePreview } from '../../modules/rallycam-export/src/capture';
import { boxToReference } from '../analysis/framing';
import type { RecorderHandle, RecorderProps } from './types';

/** The camera records at this frame rate where the phone can (120 on recent iPhones). */
const CAPTURE_FPS = 120;
/** Frames per second written to the saved video. The tracker still sees every frame the camera delivers. */
const VIDEO_FPS = 60;

/**
 * iPhone camera made for RallyCam (modules/rallycam-export/ios): a preview, person detection with Apple's Vision framework,
 * and a recorder that draws the overlay onto every frame while it records. The saved file already has the overlay in it.
 */
/** Boxes from a zoomed picture (lens zoom mode) as boxes of the full picture, which is what the trackers work in. */
const boxToReferenceBox = <T extends { x: number; y: number; w: number; h: number; z?: number }>(b: T): T => boxToReference(b, b.z);

const NativeCaptureRecorder = forwardRef<RecorderHandle, RecorderProps>(function NativeCaptureRecorder({ style, onReady, onError, onFps, onInterruption, onPressure, detection, videoProfile, lens, onLens, analysisCopy, framing, onFraming }, ref) {
  const native = Capture!;
  const analysisUri = useRef<string | undefined>(undefined);
  const Preview = CapturePreview!;

  useEffect(() => {
    let cancelled = false;
    const errors = native.addListener('onError', (e) => onError(e.message));
    const interruptions = native.addListener('onInterruption', (e) => onInterruption?.(e));
    const pressure = native.addListener('onPressure', (e) => onPressure?.(e.level));
    native.setFramingMode?.(framing ?? 'off');
    native.startSession(CAPTURE_FPS, lens ?? 'auto')
      .then((info) => {
        if (cancelled) return;
        onFps(info.fps);
        onLens?.({ lens: info.lens, available: native.getLenses() });
        onFraming?.(info.framing ?? 'off', info.lensWideRatio || undefined);
        onReady();
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
      errors.remove();
      interruptions.remove();
      pressure.remove();
      native.stopSession().catch(() => {});
    };
    // The camera starts once for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDetections = detection?.onDetections;
  useEffect(() => {
    if (!onDetections) return;
    const sub = native.addListener('onDetections', (e) => onDetections(e.boxes.map(boxToReferenceBox).map(({ ly, lcb, lcr, z: _z, ...box }) => (ly != null && lcb != null && lcr != null ? { ...box, look: [ly, lcb, lcr] as [number, number, number] } : box))));
    return () => sub.remove();
  }, [native, onDetections]);

  const roi = detection?.roi ?? null;
  const detecting = detection?.enabled === true && roi != null;
  useEffect(() => {
    if (detecting && roi) native.setDetection(true, roi.x, roi.y, roi.w, roi.h);
    else native.setDetection(false, 0, 0, 0, 0);
  }, [native, detecting, roi]);

  useImperativeHandle(ref, () => ({
    bakesOverlay: true,
    get analysisUri() { return analysisUri.current; },
    async start() {
      const p = videoProfile ?? { fps: VIDEO_FPS, width: 1920, height: 1080, bitrate: 14_000_000 };
      // Written straight into the app's own storage, so a game cut off by a crash can be found and recovered
      const uri = newGameVideoFile('mp4').uri;
      analysisUri.current = analysisCopy ? newAnalysisVideoFile().uri : undefined;
      native.startRecording(uri, p.fps, p.width, p.height, p.bitrate, analysisUri.current ?? null);
      return uri;
    },
    async stop() {
      const done = await native.stopRecording();
      analysisUri.current = done.analysisUri ?? undefined;
      return done.uri ?? undefined;
    },
    async setLens(next: string) {
      const info = await native.setLens(next, CAPTURE_FPS);
      onFps(info.fps);
      onLens?.({ lens: info.lens, available: native.getLenses() });
      return { fps: info.fps, lens: info.lens };
    },
    setOverlay(scene) {
      native.setOverlay(JSON.stringify(scene));
    },
  }), [native, videoProfile, onFps, onLens, analysisCopy]);

  return <Preview style={style} />;
});

export default NativeCaptureRecorder;
