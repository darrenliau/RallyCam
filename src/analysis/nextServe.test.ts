import { describe, expect, it } from 'vitest';
import { courtOfServer, inferWinnerFromServe } from './nextServe';

describe('courtOfServer', () => {
  it('reads left and right from the server\'s side of the net', () => {
    expect(courtOfServer('A', 0.8)).toBe('right'); // near side faces away from the camera
    expect(courtOfServer('A', 0.2)).toBe('left');
    expect(courtOfServer('B', 0.8)).toBe('left');  // far side faces the camera
    expect(courtOfServer('B', 0.2)).toBe('right');
  });
  it('cannot tell on the centre line', () => {
    expect(courtOfServer('A', 0.5)).toBeUndefined();
    expect(courtOfServer('B', 0.53)).toBeUndefined();
  });
});

describe('inferWinnerFromServe', () => {
  // if A won it would serve from the right court, if B won it would serve from the left
  const expected = { A: { side: 'A' as const, court: 'right' as const }, B: { side: 'B' as const, court: 'left' as const } };

  it('gives the point to the side that served next', () => {
    expect(inferWinnerFromServe(expected, { side: 'B' }).winner).toBe('B');
    expect(inferWinnerFromServe(expected, { side: 'A' }).winner).toBe('A');
  });
  it('is surer when the server stood in the court the score says they would serve from', () => {
    const agree = inferWinnerFromServe(expected, { side: 'A', court: 'right' });
    const unknown = inferWinnerFromServe(expected, { side: 'A' });
    const wrong = inferWinnerFromServe(expected, { side: 'A', court: 'left' });
    expect(agree.confidence).toBeGreaterThan(unknown.confidence);
    expect(wrong.confidence).toBeLessThan(unknown.confidence);
    expect(wrong.winner).toBe('A');
  });
});
