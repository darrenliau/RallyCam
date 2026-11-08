import { describe, expect, it } from 'vitest';
import { dragTo, EDGE_INSET, FAR_SCALE, handlePosition, startDrag } from './alignerDrag';

const W = 800, H = 400;

describe('handlePosition', () => {
  it('draws a corner that is on the screen where it is', () => {
    expect(handlePosition({ x: 300, y: 200 }, W, H)).toEqual({ at: { x: 300, y: 200 }, offScreen: false });
  });
  it('draws a corner that is off the screen on the nearest edge', () => {
    expect(handlePosition({ x: -500, y: 300 }, W, H)).toEqual({ at: { x: EDGE_INSET, y: 300 }, offScreen: true });
    expect(handlePosition({ x: 1200, y: 900 }, W, H)).toEqual({ at: { x: W - EDGE_INSET, y: H - EDGE_INSET }, offScreen: true });
  });
});

describe('dragTo', () => {
  it('moves an on-screen corner exactly with the finger', () => {
    const s = startDrag({ x: 300, y: 200 }, W, H);
    expect(dragTo(s, 40, -20, W, H).corner).toEqual({ x: 340, y: 180 });
  });
  it('moves an off-screen corner further than the finger', () => {
    const s = startDrag({ x: -500, y: 300 }, W, H);
    expect(dragTo(s, 50, 0, W, H).corner).toEqual({ x: -500 + 50 * FAR_SCALE, y: 300 });
  });
  it('switches to following the finger exactly once the corner is back on the screen, without jumping', () => {
    let s = startDrag({ x: -100, y: 300 }, W, H);
    let r = dragTo(s, 20, 0, W, H);   // -40: still off the screen
    expect(r.corner.x).toBe(-100 + 20 * FAR_SCALE);
    s = r.state;
    r = dragTo(s, 60, 0, W, H);       // -100 + 180 = 80: on the screen now
    expect(r.corner.x).toBe(80);
    s = r.state;
    const next = dragTo(s, 70, 0, W, H); // 10 more px of finger moves the corner exactly 10 px
    expect(next.corner.x).toBe(90);
  });
});
