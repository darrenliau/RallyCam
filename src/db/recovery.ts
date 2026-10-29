/** A game that was never finished, as the database describes it. */
export interface UnfinishedGame {
  id: string;
  rallyCount: number;
  /** When the last point was scored, in ms from the start of the video. */
  lastRallyEndMs: number | null;
  videoUri: string | null;
  /** Size of the video file now, 0 if it is missing. */
  videoBytes: number;
}

export type RecoveryAction =
  | { id: string; action: 'delete' }
  | { id: string; action: 'finish'; videoUri: string | null; durationMs: number };

/**
 * What to do with games left over from a crash, a force quit or a dead battery. Keep anything with points or a video
 * (the score was saved after every point, and the video is written in pieces so it plays up to the cut), forget the rest.
 */
export function planRecovery(games: UnfinishedGame[]): RecoveryAction[] {
  return games.map((g): RecoveryAction => {
    const hasVideo = g.videoUri != null && g.videoBytes > 0;
    if (g.rallyCount === 0 && !hasVideo) return { id: g.id, action: 'delete' };
    return {
      id: g.id,
      action: 'finish',
      videoUri: hasVideo ? g.videoUri : null,
      durationMs: g.lastRallyEndMs ?? 0,
    };
  });
}
