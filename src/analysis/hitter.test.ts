import { describe, expect, it } from 'vitest';
import { courtMap } from './court';
import { hitterSide } from './hitter';

// A court seen from behind the near baseline, with strong perspective
const map = courtMap({ farLeft: { x: 420, y: 250 }, farRight: { x: 560, y: 250 }, nearRight: { x: 780, y: 520 }, nearLeft: { x: 120, y: 520 } });
const near = { id: 0, u: 0.5, v: 0.85 };
const far = { id: 1, u: 0.5, v: 0.15 };

describe('hitterSide', () => {
  it('names the near side when the shuttle is by the near player', () => {
    const feet = map.toScreen(near.u, near.v);
    expect(hitterSide({ x: feet.x + 20, y: feet.y - 120 }, [near, far], map)?.side).toBe('A');
  });
  it('names the far side when the shuttle is by the far player, even if the near player is also close on the screen', () => {
    const feet = map.toScreen(far.u, far.v);
    const shuttle = { x: feet.x + 4, y: feet.y - 18 };
    expect(hitterSide(shuttle, [near, far], map)?.side).toBe('B');
  });
  it('allows for a racket held above the head', () => {
    const feet = map.toScreen(near.u, near.v);
    expect(hitterSide({ x: feet.x, y: feet.y - 200 }, [near], map)?.side).toBe('A');
  });
  it('does not call a shuttle two body heights away from a player a hit by them (it is on another court)', () => {
    const feet = map.toScreen(near.u, near.v);
    const along = map.toScreen(near.u + 0.05, near.v);
    const body = 1.7 * (Math.hypot(along.x - feet.x, along.y - feet.y) / (0.05 * 6.1));
    expect(hitterSide({ x: feet.x + 0.6 * body, y: feet.y - 1.3 * body }, [near], map)?.side).toBe('A');  // a smash out to the side, above the head
    expect(hitterSide({ x: feet.x + 2 * body, y: feet.y - 0.5 * body }, [near], map)).toBeUndefined();
  });
  it('says nothing when the shuttle is nowhere near a player', () => {
    expect(hitterSide({ x: 20, y: 20 }, [near, far], map)).toBeUndefined();
  });
  it('ignores a player who is lost', () => {
    const feet = map.toScreen(near.u, near.v);
    expect(hitterSide({ x: feet.x, y: feet.y - 100 }, [{ ...near, lost: 4 }, far], map)?.side).not.toBe('A');
  });
  it('has nothing to say with no players', () => {
    expect(hitterSide({ x: 300, y: 300 }, [], map)).toBeUndefined();
  });
});
