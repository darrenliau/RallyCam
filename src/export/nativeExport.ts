import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import RallyCamExport from '../../modules/rallycam-export/src';
import { buildScene, type AssInput } from './ass';

/** True only in an iPhone build that includes the native module (not Expo Go, not Android). */
export const canExportOnDevice = Platform.OS === 'ios' && RallyCamExport != null;

/**
 * Burns the overlay into a copy of the video on the phone. Resolves with the new file's uri.
 * `fps` of 0 keeps the recording's own frame rate; 30 makes a much smaller, faster export.
 */
export async function exportVideoWithOverlay(opts: {
  videoUri: string;
  input: AssInput;
  name: string;
  fps: number;
  onProgress: (fraction: number) => void;
}): Promise<string> {
  if (!RallyCamExport) throw new Error('On-phone export needs a development build on an iPhone.');

  const scene = buildScene(opts.input);
  const sceneFile = new File(Paths.cache, `${opts.name}.scene.json`);
  sceneFile.create({ overwrite: true });
  sceneFile.write(JSON.stringify(scene));
  const out = new File(Paths.cache, `${opts.name}-overlay.mp4`);

  const sub = RallyCamExport.addListener('onProgress', (e) => opts.onProgress(e.progress));
  try {
    return await RallyCamExport.exportWithOverlay(opts.videoUri, sceneFile.uri, out.uri, opts.fps);
  } finally {
    sub.remove();
    try { sceneFile.delete(); } catch { /* cache files are cleaned up by the system anyway */ }
  }
}

export const cancelExport = () => RallyCamExport?.cancelExport();
