import type { Pt } from './court';

/** How far from the screen edge (pixels) a corner that is off the screen is drawn, so it can be grabbed. */
export const EDGE_INSET = 26;
/** A corner that is off the screen moves this many times as far as the finger, so it can be pulled a long way in one drag. */
export const FAR_SCALE = 3;

const inside = (p: Pt, w: number, h: number, inset: number) => p.x >= inset && p.x <= w - inset && p.y >= inset && p.y <= h - inset;

/** Where to draw the handle of a corner: on the corner itself, or on the nearest part of the screen edge when the corner is off the screen. */
export function handlePosition(p: Pt, w: number, h: number): { at: Pt; offScreen: boolean } {
  if (inside(p, w, h, 0)) return { at: p, offScreen: false };
  return { at: { x: Math.min(w - EDGE_INSET, Math.max(EDGE_INSET, p.x)), y: Math.min(h - EDGE_INSET, Math.max(EDGE_INSET, p.y)) }, offScreen: true };
}

/** One drag of a corner handle: where the corner started, and how it follows the finger. */
export interface DragState { base: Pt; scale: number }

export function startDrag(corner: Pt, w: number, h: number): DragState {
  return { base: corner, scale: handlePosition(corner, w, h).offScreen ? FAR_SCALE : 1 };
}

/**
 * The corner after the finger has moved (dx, dy) since the drag began. An off-screen corner follows at FAR_SCALE times the finger.
 * Once it comes back onto the screen it switches to following the finger exactly, from where it is, so the handle does not jump.
 */
export function dragTo(state: DragState, dx: number, dy: number, w: number, h: number): { corner: Pt; state: DragState } {
  const corner = { x: state.base.x + state.scale * dx, y: state.base.y + state.scale * dy };
  if (state.scale !== 1 && inside(corner, w, h, EDGE_INSET)) {
    return { corner, state: { base: { x: corner.x - dx, y: corner.y - dy }, scale: 1 } };
  }
  return { corner, state };
}
