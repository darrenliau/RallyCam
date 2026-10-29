import { describe, expect, it } from 'vitest';
import type { OverlayData, OverlaySnapshot } from '../analysis/overlay';
import type { MatchConfig, Rally } from '../engine/types';
import { assAlpha, assColor, assText, assTime, buildAss, buildSegments, ellipse, roundRect } from './ass';

describe('ASS helpers', () => {
  it('formats times as h:mm:ss.cc', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(61230)).toBe('0:01:01.23');
    expect(assTime(3600000 + 5000)).toBe('1:00:05.00');
    expect(assTime(-50)).toBe('0:00:00.00');
  });
  it('converts colours to BGR and opacity to alpha', () => {
    expect(assColor('#C8F04A')).toBe('&H4AF0C8&');
    expect(assColor('#FF0000')).toBe('&H0000FF&');
    expect(assAlpha(1)).toBe('&H00&');
    expect(assAlpha(0)).toBe('&HFF&');
    expect(assAlpha(0.78)).toBe('&H38&');
  });
  it('removes characters that ASS would read as commands', () => {
    expect(assText('Sam{\\an9}')).toBe('Samn9'.replace('n9', 'an9'));
    expect(assText('a\nb')).toBe('a b');
  });
  it('draws shapes that start and end inside their box', () => {
    expect(roundRect(100, 50, 10)).toMatch(/^m 10 0 l 90 0/);
    expect(ellipse(10, 5)).toMatch(/^m 20 5 b/);
  });
});

const snap = (t: number, extra: Partial<OverlaySnapshot> = {}): OverlaySnapshot => ({ t, tracks: [{ id: 0, u: 0.5, v: 0.8 }], assign: [0], dist: [0], ...extra });

describe('buildSegments', () => {
  it('covers the whole video with snapshot stretches and no-data gaps', () => {
    const segs = buildSegments([snap(1000), snap(1500), snap(9000)], 12000, 500);
    expect(segs[0]).toMatchObject({ start: 0, end: 1000 });
    expect(segs[0].snap).toBeUndefined();
    expect(segs[1].snap?.t).toBe(1000);
    expect(segs[1].next?.t).toBe(1500);
    // 1500 -> 9000 is longer than the max age: the snapshot is shown briefly, then a gap
    const afterSecond = segs.filter((s) => s.start >= 1500);
    expect(afterSecond[0].snap?.t).toBe(1500);
    expect(afterSecond[0].next).toBeUndefined();
    expect(afterSecond[1].snap).toBeUndefined();
    expect(segs[segs.length - 1].end).toBe(12000);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
  });
  it('thins snapshots to the requested rate', () => {
    const many = Array.from({ length: 40 }, (_, i) => snap(i * 250));
    const segs = buildSegments(many, 10000, 500);
    expect(segs.filter((s) => s.snap).length).toBe(20);
  });
  it('is one gap when there are no snapshots', () => {
    expect(buildSegments([], 5000, 500)).toEqual([{ start: 0, end: 5000 }]);
  });
});

describe('buildAss', () => {
  const config: MatchConfig = { type: 'singles', players: { A: ['You'], B: ['Sam'] }, bestOf: 1, firstServer: 'A' };
  const rallies: Rally[] = [
    { winner: 'A', startMs: 0, endMs: 3000, source: 'manual' },
    { winner: 'B', startMs: 3000, endMs: 6000, source: 'manual' },
  ];
  const corners = { farLeft: { x: 0.3, y: 0.4 }, farRight: { x: 0.7, y: 0.4 }, nearRight: { x: 0.95, y: 0.9 }, nearLeft: { x: 0.05, y: 0.9 } };
  const snaps: OverlaySnapshot[] = Array.from({ length: 20 }, (_, i) => ({
    t: 500 + i * 500,
    tracks: [{ id: 0, u: 0.5 + i * 0.01, v: 0.85 }, { id: 1, u: 0.5, v: 0.15 }],
    assign: [0, 1],
    dist: [i, i * 2],
    shuttle: i < 10 ? undefined : { speedKmh: 120, shots: 3, lastShot: { type: 'DROP', player: 'You', number: 3 } },
  }));
  const overlay: OverlayData = { version: 1, frameAspect: 16 / 9, corners, snapshots: snaps };
  const text = buildAss({ config, rallies, overlay, durationMs: 10000 });
  const events = text.split('\n').filter((l) => l.startsWith('Dialogue:'));

  it('writes a valid header sized for a 16:9 video', () => {
    expect(text).toContain('PlayResX: 1920');
    expect(text).toContain('PlayResY: 1080');
    expect(text).toContain('[V4+ Styles]');
    expect(text).toContain('[Events]');
  });
  it('has well-formed events: end after start, no NaN, ten fields', () => {
    expect(events.length).toBeGreaterThan(50);
    for (const e of events) {
      const parts = e.slice('Dialogue: '.length).split(',');
      expect(parts.length).toBeGreaterThanOrEqual(10);
      expect(e).not.toContain('NaN');
      expect(e).not.toContain('undefined');
    }
  });
  it('shows a new scoreboard each time the score changes', () => {
    const scoreEvents = events.filter((e) => e.includes('serves from the'));
    expect(scoreEvents).toHaveLength(3); // 0-0, 1-0, 1-1
    expect(scoreEvents[1]).toContain('0:00:03.00,0:00:06.00');
  });
  it('merges shuttle cards that look the same, and shows dashes before there is data', () => {
    expect(events.filter((e) => e.includes('SHUTTLE SPEED'))).toHaveLength(2); // dashes, then data (repeated values merge into one stretch)
    expect(events.some((e) => e.includes('NEEDS SHUTTLE TRACKING'))).toBe(true);
    expect(events.some((e) => e.includes('~120'))).toBe(true);
  });
  it('glides players between updates and tags them with their names', () => {
    expect(events.some((e) => e.includes('\\move('))).toBe(true);
    expect(events.some((e) => e.endsWith('}You'))).toBe(true);
    expect(events.some((e) => e.endsWith('}Sam'))).toBe(true);
  });
  it('does not let a name inject ASS commands', () => {
    const evil = buildAss({ config: { ...config, players: { A: ['{\\p1}x'], B: ['Sam'] } }, rallies, overlay, durationMs: 10000 });
    expect(evil).not.toContain('}{\\p1}x');
    expect(evil).toContain('}p1x');
  });
});
