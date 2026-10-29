import { describe, expect, it } from 'vitest';
import { planRecovery } from './recovery';

describe('planRecovery', () => {
  it('forgets games with no points and no video', () => {
    expect(planRecovery([{ id: 'a', rallyCount: 0, lastRallyEndMs: null, videoUri: null, videoBytes: 0 }])).toEqual([{ id: 'a', action: 'delete' }]);
    // a video path that was never written to
    expect(planRecovery([{ id: 'a', rallyCount: 0, lastRallyEndMs: null, videoUri: 'file:///x.mp4', videoBytes: 0 }])[0].action).toBe('delete');
  });
  it('keeps a game with points and finishes it at the last point', () => {
    expect(planRecovery([{ id: 'b', rallyCount: 9, lastRallyEndMs: 120000, videoUri: 'file:///b.mp4', videoBytes: 5_000_000 }])).toEqual([
      { id: 'b', action: 'finish', videoUri: 'file:///b.mp4', durationMs: 120000 },
    ]);
  });
  it('keeps the score when the video is gone', () => {
    expect(planRecovery([{ id: 'c', rallyCount: 4, lastRallyEndMs: 60000, videoUri: 'file:///gone.mp4', videoBytes: 0 }])).toEqual([
      { id: 'c', action: 'finish', videoUri: null, durationMs: 60000 },
    ]);
  });
  it('keeps a video even if no point was scored before the cut', () => {
    expect(planRecovery([{ id: 'd', rallyCount: 0, lastRallyEndMs: null, videoUri: 'file:///d.mp4', videoBytes: 1000 }])[0]).toMatchObject({ action: 'finish', durationMs: 0 });
  });
});
