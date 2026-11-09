import { describe, expect, it } from 'vitest';
import { FOOTAGE_PRESET, mbPerMinute, nextLensName, parseSetting, QUALITY } from './settingsModel';

describe('quality presets', () => {
  it('estimates storage per minute from the bitrate', () => {
    expect(mbPerMinute(QUALITY.balanced)).toBeCloseTo(60, 5); // 8 Mbit/s = 1 MB/s = 60 MB per minute
    expect(mbPerMinute(QUALITY.small)).toBeCloseTo(30, 5);
    expect(mbPerMinute(QUALITY.high)).toBeCloseTo(105, 5);
    expect(mbPerMinute(FOOTAGE_PRESET)).toBeGreaterThan(200);
  });
  it('gets smaller as the quality goes down', () => {
    expect(mbPerMinute(QUALITY.high)).toBeGreaterThan(mbPerMinute(QUALITY.balanced));
    expect(mbPerMinute(QUALITY.balanced)).toBeGreaterThan(mbPerMinute(QUALITY.small));
  });
});

describe('parseSetting', () => {
  it('accepts known values', () => {
    expect(parseSetting('quality', 'small')).toBe('small');
    expect(parseSetting('guideSeen', '1')).toBe(true);
    expect(parseSetting('experimentalShuttle', '0')).toBe(false);
    expect(parseSetting('shuttleModel', '1')).toBe(true);
    expect(parseSetting('cropModel', '0')).toBe(false);
    expect(parseSetting('courtOnly', '1')).toBe(true);
    expect(parseSetting('watchPreview', '0')).toBe(false);
    expect(parseSetting('lastGame', JSON.stringify({ type: 'singles', players: { A: ['You'], B: ['Sam'] } }))).toContain('singles');
    expect(parseSetting('lastGame', 'garbage')).toBeUndefined();
    expect(parseSetting('keepAnalysisCopy', '1')).toBe(true);
    expect(parseSetting('keepAnalysisCopy', 'x')).toBeUndefined();
    expect(parseSetting('lens', 'ultra-wide')).toBe('ultra-wide');
    expect(parseSetting('lens', 'fisheye')).toBeUndefined();
  });
  it('ignores values it does not recognise', () => {
    expect(parseSetting('quality', 'ultra')).toBeUndefined();
    expect(parseSetting('guideSeen', 'yes')).toBeUndefined();
  });
});

describe('nextLensName', () => {
  const lenses = ['ultra-wide', 'wide', 'tele'];
  it('goes to the next lens each time, and round to the first after the last', () => {
    expect(nextLensName(lenses, 'ultra-wide')).toBe('wide');
    expect(nextLensName(lenses, 'wide')).toBe('tele');
    expect(nextLensName(lenses, 'tele')).toBe('ultra-wide');
  });
  it('starts from the first when the current lens is not in the list, and says nothing without lenses', () => {
    expect(nextLensName(lenses, 'fisheye')).toBe('ultra-wide');
    expect(nextLensName(lenses, undefined)).toBe('ultra-wide');
    expect(nextLensName([], 'wide')).toBeUndefined();
  });
  it('with two lenses it goes back and forth', () => {
    expect(nextLensName(['wide', 'tele'], 'wide')).toBe('tele');
    expect(nextLensName(['wide', 'tele'], 'tele')).toBe('wide');
  });
});
