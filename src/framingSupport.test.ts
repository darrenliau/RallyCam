import { describe, expect, it } from 'vitest';
import { effectiveFraming, framingAvailability } from './framingSupport';

const build = (cropFps: number, lens: boolean) => ({ setFramingTarget: () => {}, getFramingSupport: () => ({ cropFps, lens }) });

describe('framingAvailability', () => {
  it('turns both modes off in a build without the camera part, with the reason', () => {
    const a = framingAvailability({});
    expect(a.crop.ok).toBe(false);
    expect(a.lens.ok).toBe(false);
    expect(a.crop.reason).toMatch(/build/);
    expect(a.off.ok).toBe(true);
  });
  it('turns both off with no camera module at all (Expo Go, Android)', () => {
    expect(framingAvailability(undefined).crop.ok).toBe(false);
  });
  it('turns crop off when the phone cannot do 4K', () => {
    const a = framingAvailability(build(0, true));
    expect(a.crop.ok).toBe(false);
    expect(a.crop.reason).toMatch(/4K/);
    expect(a.lens.ok).toBe(true);
  });
  it('turns crop off when 4K is slower than 30 frames a second', () => {
    expect(framingAvailability(build(24, true)).crop.ok).toBe(false);
  });
  it('allows crop at 30 with a note about the frame rate, and at 60 without', () => {
    const a = framingAvailability(build(30, true));
    expect(a.crop.ok).toBe(true);
    expect(a.crop.note).toMatch(/30/);
    expect(framingAvailability(build(60, true)).crop.note).toBeUndefined();
  });
  it('turns lens off when there is no joined camera', () => {
    const a = framingAvailability(build(60, false));
    expect(a.lens.ok).toBe(false);
    expect(a.crop.ok).toBe(true);
  });
  it('treats a failing question as not supported', () => {
    const a = framingAvailability({ setFramingTarget: () => {}, getFramingSupport: () => { throw new Error('x'); } });
    expect(a.crop.ok).toBe(false);
    expect(a.lens.ok).toBe(false);
  });
});

describe('effectiveFraming', () => {
  it('uses the chosen mode when it is available and off when it is not', () => {
    const a = framingAvailability(build(0, true));
    expect(effectiveFraming('lens', a)).toBe('lens');
    expect(effectiveFraming('crop', a)).toBe('off');
    expect(effectiveFraming('off', a)).toBe('off');
  });
});
