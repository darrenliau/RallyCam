import { newGameVideoFile } from '../export/storage';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { Capture, CapturePreview } from '../../modules/rallycam-export/src/capture';
import type { RecorderHandle, RecorderProps } from './types';

/** The camera records at this frame rate where the phone can (120 on recent iPhones). */
const CAPTURE_FPS = 120;
/** Frames per second written to the saved video. The tracker still sees every frame the camera delivers. */
const VIDEO_FPS = 60;

/**
 * iPhone camera made for RallyCam (modules/rallycam-export/ios): a preview, person detection with Apple's Vision framework,
 * and a recorder that draws the overlay onto every frame while it records. The saved file already has the overlay in it.
 */
const NativeCaptureRecorder = forwardRef<RecorderHandle, RecorderProps>(function NativeCaptureRecorder({ style, onReady, onError, onFps, onInterruption, onPressure, detection, videoProfile }, ref) {
  const native = Capture!;
  const Preview = CapturePreview!;

  useEffect(() => {
    let cancelled = false;
    const errors = native.addListener('onError', (e) => onError(e.message));
    const interruptions = native.addListener('onInterruption', (e) => onInterruption?.(e));
    const pressure = native.addListener('onPressure', (e) => onPressure?.(e.level));
    native.startSession(CAPTURE_FPS)
      .then((info) => {
        if (cancelled) return;
        onFps(info.fps);
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
    const sub = native.addListener('onDetections', (e) => onDetections(e.boxes));
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
    async start() {
      const p = videoProfile ?? { fps: VIDEO_FPS, width: 1920, height: 1080, bitrate: 14_000_000 };
      // Written straight into the app's own storage, so a game cut off by a crash can be found and recovered
      const uri = newGameVideoFile('mp4').uri;
      native.startRecording(uri, p.fps, p.width, p.height, p.bitrate);
      return uri;
    },
    async stop() {
      return (await native.stopRecording()) ?? undefined;
    },
    setOverlay(scene) {
      native.setOverlay(JSON.stringify(scene));
    },
  }), [native, videoProfile]);

  return <Preview style={style} />;
});

export default NativeCaptureRecorder;
