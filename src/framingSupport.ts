import type { FramingMode } from './settingsModel';

/** Crop mode needs the ultra-wide camera to do 4K at least this fast. */
export const MIN_CROP_FPS = 30;

export interface FramingOption { ok: boolean; reason?: string; note?: string }
export type FramingAvailability = Record<FramingMode, FramingOption>;

/** The part of the camera module this needs, so it can be tested without the phone. */
export interface FramingNative {
  setFramingTarget?: unknown;
  getFramingSupport?: () => { cropFps: number; lens: boolean };
}

/**
 * Which auto-framing modes this phone and this build can do, and why not. The Settings screen disables the ones that cannot, and the
 * Record screen only uses a mode that is available, so a stored choice that the phone cannot do is treated as off.
 */
export function framingAvailability(native: FramingNative | null | undefined): FramingAvailability {
  const off: FramingOption = { ok: true };
  if (!native || typeof native.setFramingTarget !== 'function' || typeof native.getFramingSupport !== 'function') {
    const reason = 'This build of the app does not have it yet.';
    return { off, crop: { ok: false, reason }, lens: { ok: false, reason } };
  }
  let support: { cropFps: number; lens: boolean };
  try { support = native.getFramingSupport(); } catch { support = { cropFps: 0, lens: false }; }
  const crop: FramingOption = support.cropFps <= 0
    ? { ok: false, reason: 'This phone\'s ultra-wide camera cannot record 4K.' }
    : support.cropFps < MIN_CROP_FPS
      ? { ok: false, reason: `This phone's ultra-wide camera only does ${support.cropFps} frames a second at 4K (30 are needed).` }
      : support.cropFps < 60
        ? { ok: true, note: `4K on this phone is limited to ${support.cropFps} frames a second, so the video will be ${support.cropFps} fps while this is on.` }
        : { ok: true };
  const lens: FramingOption = support.lens ? { ok: true } : { ok: false, reason: 'This phone has no camera that joins its ultra-wide and wide lenses.' };
  return { off, crop, lens };
}

/** The mode to use: the one chosen, unless it cannot be done here. */
export function effectiveFraming(chosen: FramingMode, available: FramingAvailability): FramingMode {
  return available[chosen]?.ok ? chosen : 'off';
}
