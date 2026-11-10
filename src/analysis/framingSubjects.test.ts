import { describe, expect, it } from 'vitest';
import { courtMap, defaultCorners } from './court';
import { playerSubjects, shuttleSubject } from './framingSubjects';

const g = { frameAspect: 16 / 9, screenW: 1600, screenH: 900 };
const map = courtMap(defaultCorners(1600, 900));

describe('playerSubjects', () => {
  it('gives the feet and a head above them for each player', () => {
    const s = playerSubjects([{ id: 1, u: 0.5, v: 0.8 }], map, g);
    expect(s).toHaveLength(2);
    expect(s[1].y).toBeLessThan(s[0].y);
    expect(s[1].x).toBeCloseTo(s[0].x);
    expect(s.every((p) => p.kind === 'player')).toBe(true);
  });
  it('leaves out a player who is not seen', () => {
    expect(playerSubjects([{ id: 1, u: 0.5, v: 0.8, lost: 3 }], map, g)).toHaveLength(0);
  });
  it('makes a nearer player taller in the picture', () => {
    const near = playerSubjects([{ id: 1, u: 0.5, v: 0.95 }], map, g);
    const far = playerSubjects([{ id: 2, u: 0.5, v: 0.1 }], map, g);
    expect(near[0].y - near[1].y).toBeGreaterThan(far[0].y - far[1].y);
  });
});

describe('shuttleSubject', () => {
  it('is nothing without a trail', () => {
    expect(shuttleSubject([], 0.4)).toBeNull();
  });
  it('has a speed from the path', () => {
    const s = shuttleSubject([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }], 0.2)!;
    expect(s.vx).toBeCloseTo(1);
    expect(s.kind).toBe('shuttle');
  });
});
