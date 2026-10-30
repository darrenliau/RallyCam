import { describe, expect, it } from 'vitest';
import { FOOTAGE_PRESET, mbPerMinute, parseSetting, QUALITY } from './settingsModel';

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
    expect(parseSetting('lens', 'ultra-wide')).toBe('ultra-wide');
    expect(parseSetting('lens', 'fisheye')).toBeUndefined();
  });
  it('ignores values it does not recognise', () => {
    expect(parseSetting('quality', 'ultra')).toBeUndefined();
    expect(parseSetting('guideSeen', 'yes')).toBeUndefined();
  });
});
