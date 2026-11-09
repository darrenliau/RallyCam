import { parseLastGame } from './lastGame';

export type VideoQuality = 'high' | 'balanced' | 'small';

/** Which camera lens to film with. "auto" picks the widest one that keeps the frame rate. */
export type Lens = 'auto' | 'ultra-wide' | 'wide' | 'tele';
export const LENSES: Lens[] = ['auto', 'ultra-wide', 'wide', 'tele'];

/** The lens after `current` in the phone's list, going back to the first after the last (and to the first if `current` is not in the list). */
export function nextLensName(available: string[], current: string | undefined): string | undefined {
  if (!available.length) return undefined;
  const i = current === undefined ? -1 : available.indexOf(current);
  return available[(i + 1) % available.length];
}

/** What to call a lens on screen. */
export const LENS_LABEL: Record<string, string> = { auto: 'Auto', 'ultra-wide': '0.5×', wide: '1×', tele: 'Tele' };

export interface QualityPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Video bits per second. */
  bitrate: number;
  note: string;
}

export const QUALITY: Record<VideoQuality, QualityPreset> = {
  high: { label: 'High', width: 1920, height: 1080, fps: 60, bitrate: 14_000_000, note: '1080p, 60 frames per second. Smoothest for fast play.' },
  balanced: { label: 'Balanced', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000, note: '1080p, 30 frames per second. Good for most games.' },
  small: { label: 'Small', width: 1280, height: 720, fps: 30, bitrate: 4_000_000, note: '720p, 30 frames per second. Smallest files.' },
};

/** Footage mode for shuttle-tracking training: always the camera's best. */
export const FOOTAGE_PRESET: QualityPreset = { label: 'Footage', width: 1920, height: 1080, fps: 120, bitrate: 30_000_000, note: '' };

/** About how many megabytes one minute of video takes (video track only, sound adds a little). */
export const mbPerMinute = (p: QualityPreset): number => (p.bitrate / 8) * 60 / 1e6;

export interface Settings {
  quality: VideoQuality;
  /** The first-run guide has been seen. */
  guideSeen: boolean;
  /** Try to follow the shuttle with the camera (experimental, iPhone only). */
  experimentalShuttle: boolean;
  /** Use the trained shuttle model (TrackNetV3 on the Neural Engine) instead of the simple tracker, when the build has it. */
  shuttleModel: boolean;
  /** Show the shuttle model only the court and the air above it, so the shuttle is bigger to it. Falls back to the whole frame when the shuttle leaves the crop. */
  cropModel: boolean;
  /** Follow the shuttle only over the aligned court, not on the courts beside it. */
  courtOnly: boolean;
  /** The setup of the last game started (JSON text, see lastGame.ts), so the watch can start another one. Empty until one has been. */
  lastGame: string;
  /** Send the Apple Watch app a small live picture of the camera while the Record screen is open. */
  watchPreview: boolean;
  /** Also keep a clean, smaller copy of each game with no overlay, for analysing the shuttle afterwards (iPhone only). */
  keepAnalysisCopy: boolean;
  /** The lens last used, so the saved court lines still fit next time. */
  lens: Lens;
}

export const DEFAULT_SETTINGS: Settings = { quality: 'balanced', guideSeen: false, experimentalShuttle: false, shuttleModel: false, cropModel: true, courtOnly: true, watchPreview: true, lastGame: '', keepAnalysisCopy: false, lens: 'auto' };

/** Reads one stored value back into the right type, ignoring anything unexpected. */
export function parseSetting<K extends keyof Settings>(key: K, raw: string): Settings[K] | undefined {
  if (key === 'quality') return (raw in QUALITY ? raw : undefined) as Settings[K] | undefined;
  if (key === 'guideSeen' || key === 'experimentalShuttle' || key === 'shuttleModel' || key === 'cropModel' || key === 'courtOnly' || key === 'watchPreview' || key === 'keepAnalysisCopy') return (raw === '1' ? true : raw === '0' ? false : undefined) as Settings[K] | undefined;
  if (key === 'lastGame') return (parseLastGame(raw) ? raw : undefined) as Settings[K] | undefined;
  if (key === 'lens') return ((LENSES as string[]).includes(raw) ? raw : undefined) as Settings[K] | undefined;
  return undefined;
}

