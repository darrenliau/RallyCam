import { describe, expect, it } from 'vitest';
import { courtRegion } from './courtRegion';

// a court seen from behind a baseline: narrow at the far end, wide at the near end
const corners = { farLeft: { x: 0.35, y: 0.5 }, farRight: { x: 0.65, y: 0.5 }, nearRight: { x: 0.9, y: 0.9 }, nearLeft: { x: 0.1, y: 0.9 } };
const inside = courtRegion(corners);

describe('courtRegion', () => {
  it('accepts the court floor and the air above it', () => {
    expect(inside(0.5, 0.7)).toBe(true);
    expect(inside(0.5, 0.52)).toBe(true);
    expect(inside(0.5, 0.3)).toBe(true);     // above the far baseline
    expect(inside(0.5, 0.15)).toBe(true);    // a high lob
  });
  it('accepts a little beyond the side lines and the near baseline edge', () => {
    expect(inside(0.08, 0.89)).toBe(true);
    expect(inside(0.5, 0.9)).toBe(true);
  });
  it('rejects other courts, walls and ceiling beside or far above the court', () => {
    expect(inside(0.95, 0.6)).toBe(false);   // a court to the right
    expect(inside(0.05, 0.6)).toBe(false);   // a court to the left
    expect(inside(0.9, 0.2)).toBe(false);    // the wall/ceiling at the top right
    expect(inside(0.5, 0.0)).toBe(false);    // above the raised region
    expect(inside(0.5, 0.97)).toBe(false);   // below the near baseline
  });
});
