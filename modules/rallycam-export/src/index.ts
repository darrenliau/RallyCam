import { NativeModule, requireOptionalNativeModule } from 'expo';

type Events = { onProgress: (event: { progress: number }) => void };

declare class RallyCamExportModule extends NativeModule<Events> {
  /** Draws the overlay scene onto every frame and writes a new video. Resolves with the new file's uri. */
  exportWithOverlay(videoUri: string, sceneUri: string, outUri: string, fps: number): Promise<string>;
  cancelExport(): void;
}

/** null in Expo Go, on Android, and in builds made before the module was added. */
export default requireOptionalNativeModule<RallyCamExportModule>('RallyCamExport');
