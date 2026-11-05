import { describe, expect, it } from 'vitest';
import { ModelTrackFilter, type ModelFrame } from './modelTrack';

const DT = 1 / 60;
/** A lob across the picture: moves right and up then down, in frame fractions, one sighting per frame from frame `from`.
 *  The path depends only on the frame number, so lob(0, 6) followed by lob(14, 3) is one flight with a gap. */
const lob = (from: number, n: number, x0 = 0.2): ModelFrame[] =>
  Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return { t: k * DT, x: x0 + 0.004 * k, y: 0.5 - 0.0035 * k + 0.00012 * k * k };
  });
const miss = (from: number, n: number): ModelFrame[] => Array.from({ length: n }, (_, i) => ({ t: (from + i) * DT }));

describe('ModelTrackFilter', () => {
  it('holds back the first sightings of a flight and then hands them over together', () => {
    const f = new ModelTrackFilter();
    const frames = lob(0, 8);
    expect(f.push(frames.slice(0, 3))).toHaveLength(0);
    const fourth = f.push(frames.slice(3, 4));
    expect(fourth.map((s) => s.t)).toEqual(frames.slice(0, 4).map((s) => s.t));
    expect(f.push(frames.slice(4))).toHaveLength(4);
  });

  it('passes positions on as fractions of the frame', () => {
    const f = new ModelTrackFilter();
    const out = f.push(lob(0, 4));
    expect(out[0].x).toBeCloseTo(0.2, 6);
    expect(out[0].y).toBeCloseTo(0.5, 6);
  });

  it('never accepts a lone sighting, however often they turn up', () => {
    const f = new ModelTrackFilter();
    const lone: ModelFrame[] = [];
    for (let i = 0; i < 30; i++) lone.push(i % 5 === 0 ? { t: i * DT, x: 0.1 + 0.05 * (i % 7), y: 0.3 + 0.04 * (i % 3) } : { t: i * DT });
    expect(f.push(lone)).toHaveLength(0);
  });

  it('starts again after a jump to somewhere else', () => {
    const f = new ModelTrackFilter();
    expect(f.push(lob(0, 6))).toHaveLength(6);
    const elsewhere = lob(6, 6, 0.8).map((s) => ({ ...s, y: (s.y ?? 0) + 0.2 }));
    const out = f.push(elsewhere);
    expect(out).toHaveLength(6); // held back until the new flight has proved itself, then all handed over
    expect(out[0].x).toBeGreaterThan(0.8);
    expect(out[0].t).toBeCloseTo(6 * DT, 9);
  });

  it('keeps following through a short run of misses', () => {
    const f = new ModelTrackFilter();
    f.push(lob(0, 6));
    f.push(miss(6, 8)); // 0.13 s of nothing
    const resumed = f.push(lob(14, 3));
    expect(resumed).toHaveLength(3); // each is believed at once, because the flight was already proved
  });

  it('forgets the flight after a long gap', () => {
    const f = new ModelTrackFilter();
    f.push(lob(0, 6));
    f.push(miss(6, 40));
    expect(f.push(lob(46, 3))).toHaveLength(0);
  });

  it('drops something that sits still', () => {
    const f = new ModelTrackFilter();
    const still: ModelFrame[] = Array.from({ length: 30 }, (_, i) => ({ t: i * DT, x: 0.475, y: 0.247 }));
    expect(f.push(still)).toHaveLength(0);
  });

  it('stops passing sightings on once a flight comes to rest, such as a shuttle on the floor', () => {
    const f = new ModelTrackFilter();
    const flight = lob(0, 8);
    const last = flight[flight.length - 1];
    const rest: ModelFrame[] = Array.from({ length: 20 }, (_, i) => ({ t: (8 + i) * DT, x: last.x, y: last.y }));
    const out = f.push([...flight, ...rest]);
    expect(out.length).toBeLessThan(8 + 6); // the rest of the sightings are not all passed on
    expect(out.length).toBeGreaterThanOrEqual(8);
  });

  it('rejects a zig-zag even though every step is a plausible size', () => {
    const f = new ModelTrackFilter();
    const zig: ModelFrame[] = Array.from({ length: 12 }, (_, i) => ({ t: i * DT, x: 0.2 + 0.01 * i, y: 0.5 + (i % 2 ? 0.03 : -0.03) }));
    expect(f.push(zig)).toHaveLength(0);
  });

  it('ignores frames that arrive out of order', () => {
    const f = new ModelTrackFilter();
    f.push(lob(10, 5));
    expect(() => f.push(lob(0, 3))).not.toThrow();
  });
});

describe('ModelTrackFilter region', () => {
  it('ignores a flight that is outside the region', () => {
    const flight = (x0: number) => Array.from({ length: 16 }, (_, i) => ({ t: i / 60, x: x0 + i * 0.004, y: 0.4 + 0.1 * Math.sin(i / 5) }));
    const open = new ModelTrackFilter();
    expect(open.push(flight(0.7)).length).toBeGreaterThan(0);
    const gated = new ModelTrackFilter();
    gated.setRegion((x) => x < 0.5);
    expect(gated.push(flight(0.7))).toEqual([]);
    expect(gated.push(flight(0.1).map((f) => ({ ...f, t: f.t + 1 }))).length).toBeGreaterThan(0);
  });
});
