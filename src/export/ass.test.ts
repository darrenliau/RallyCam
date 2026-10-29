import { describe, expect, it } from 'vitest';
import type { OverlayData, OverlaySnapshot } from '../analysis/overlay';
import type { MatchConfig, Rally } from '../engine/types';
import { assAlpha, assColor, assText, assTime, buildAss, buildLiveScene, buildScene, buildSegments, ellipse, roundRect } from './ass';
import { replay } from '../engine/scoring';

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

describe('buildScene (also read by the iPhone exporter)', () => {
  const config: MatchConfig = { type: 'doubles', players: { A: ['You', 'Mia'], B: ['Sam', 'Jun'] }, bestOf: 1, firstServer: 'A' };
  const corners = { farLeft: { x: 0.3, y: 0.4 }, farRight: { x: 0.7, y: 0.4 }, nearRight: { x: 0.95, y: 0.9 }, nearLeft: { x: 0.05, y: 0.9 } };
  const snaps: OverlaySnapshot[] = Array.from({ length: 12 }, (_, i) => ({
    t: 500 + i * 500,
    tracks: [0, 1, 2, 3].map((id) => ({ id, u: 0.3 + id * 0.1 + i * 0.01, v: id < 2 ? 0.8 : 0.2 })),
    assign: [0, 1, 2, 3],
    dist: [i, i, i, i],
    shuttle: { speedKmh: 100 + i, shots: i, lastShot: { type: 'CLEAR', player: 'You', number: i } },
  }));
  const overlay: OverlayData = { version: 1, frameAspect: 16 / 9, corners, snapshots: snaps };
  const rallies: Rally[] = [{ winner: 'A', startMs: 0, endMs: 3000, source: 'manual' }];
  const scene = buildScene({ config, rallies, overlay, durationMs: 8000 });

  it('is a 1920 wide scene for a 16:9 video', () => {
    expect(scene.width).toBe(1920);
    expect(scene.height).toBe(1080);
    expect(scene.items.length).toBeGreaterThan(50);
  });

  it('has items the Swift decoder can read: finite numbers, ordered times, paired glide targets, known anchors', () => {
    for (const it of scene.items) {
      for (const n of [it.l, it.a, it.b, it.x, it.y]) expect(Number.isFinite(n)).toBe(true);
      expect(it.b).toBeGreaterThan(it.a);
      expect(it.mx === undefined).toBe(it.my === undefined);
      expect(it.c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      if (it.k === 's') {
        expect(it.o).toBeGreaterThanOrEqual(0);
        expect(it.o).toBeLessThanOrEqual(1);
      } else {
        expect([7, 8, 9]).toContain(it.an);
        expect(it.z).toBeGreaterThan(0);
        expect(it.s).not.toMatch(/[{}\\]/);
      }
    }
  });

  it('writes paths in the m / l / b form the Swift parser reads, with the right number of numbers', () => {
    const perCommand: Record<string, number> = { m: 2, l: 2, b: 6 };
    for (const it of scene.items) {
      if (it.k !== 's') continue;
      const tokens = it.d.split(' ');
      let i = 0;
      while (i < tokens.length) {
        const need = perCommand[tokens[i]];
        expect(need, `unknown command in ${it.d.slice(0, 40)}`).toBeDefined();
        for (let j = 1; j <= need; j++) expect(Number.isFinite(Number(tokens[i + j]))).toBe(true);
        i += need + 1;
      }
    }
  });

  it('survives a JSON round trip unchanged (it is written to a file for the phone)', () => {
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});

describe('buildLiveScene (drawn into the video while recording)', () => {
  const config: MatchConfig = { type: 'singles', players: { A: ['You'], B: ['Sam'] }, bestOf: 1, firstServer: 'A' };
  const state = replay(config, [{ winner: 'A', startMs: 0, endMs: 1000, source: 'manual' }]);
  const corners = { farLeft: { x: 0.3, y: 0.4 }, farRight: { x: 0.7, y: 0.4 }, nearRight: { x: 0.95, y: 0.9 }, nearLeft: { x: 0.05, y: 0.9 } };
  const snapshot: OverlaySnapshot = {
    t: 0,
    tracks: [{ id: 0, u: 0.5, v: 0.8 }, { id: 1, u: 0.5, v: 0.2 }],
    assign: [0, 1],
    dist: [12, 9],
    shuttle: { speedKmh: 150, shots: 4, lastShot: { type: 'SMASH', player: 'You', number: 4 } },
  };

  it('shows everything for as long as it is the latest overlay', () => {
    const scene = buildLiveScene({ config, state, snapshot, corners, frameAspect: 16 / 9 });
    expect(scene.width).toBe(1920);
    expect(scene.items.length).toBeGreaterThan(20);
    for (const it of scene.items) {
      expect(it.a).toBe(0);
      expect(it.b).toBeGreaterThan(1e8);
      expect(it.mx).toBeUndefined(); // nothing glides: there is no next snapshot
    }
  });

  it('draws the current score, tags and speed', () => {
    const texts = buildLiveScene({ config, state, snapshot, corners, frameAspect: 16 / 9 }).items.flatMap((i) => (i.k === 't' ? [i.s] : []));
    expect(texts).toContain('1'); // You: 1
    expect(texts).toContain('You');
    expect(texts).toContain('Sam');
    expect(texts).toContain('~150');
    expect(texts).toContain('SMASH');
    expect(texts).toContain('~12 m');
  });

  it('shows dashes and no players when nothing is tracked', () => {
    const scene = buildLiveScene({ config, state, corners, frameAspect: 16 / 9 });
    const texts = scene.items.flatMap((i) => (i.k === 't' ? [i.s] : []));
    expect(texts).toContain('NEEDS SHUTTLE TRACKING');
    expect(texts).not.toContain('~150');
    expect(scene.items.some((i) => i.k === 's' && i.l === 20)).toBe(false); // no player rings
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});

describe('hiding empty shuttle cards (store builds)', () => {
  const config: MatchConfig = { type: 'singles', players: { A: ['You'], B: ['Sam'] }, bestOf: 1, firstServer: 'A' };
  const state = replay(config, []);
  const corners = { farLeft: { x: 0.3, y: 0.4 }, farRight: { x: 0.7, y: 0.4 }, nearRight: { x: 0.95, y: 0.9 }, nearLeft: { x: 0.05, y: 0.9 } };
  const texts = (hide: boolean, withShuttle: boolean) =>
    buildLiveScene({
      config, state, corners, frameAspect: 16 / 9, hideEmptyShuttle: hide,
      snapshot: { t: 0, tracks: [], assign: [], dist: [0, 0], ...(withShuttle ? { shuttle: { speedKmh: 99, shots: 2 } } : {}) },
    }).items.flatMap((i) => (i.k === 't' ? [i.s] : []));

  it('leaves the cards out when there is no shuttle data', () => {
    expect(texts(true, false)).not.toContain('SHUTTLE SPEED');
    expect(texts(false, false)).toContain('SHUTTLE SPEED');
  });
  it('still shows them once the shuttle is tracked', () => {
    expect(texts(true, true)).toContain('SHUTTLE SPEED');
    expect(texts(true, true)).toContain('~99');
  });
});
