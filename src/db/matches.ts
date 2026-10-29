import type { OverlayData } from '../analysis/overlay';
import { replay } from '../engine/scoring';
import type { MatchConfig, MatchState, Rally, Side } from '../engine/types';
import { getDb } from './db';
import { inOrder } from './inOrder';
import { planRecovery, type UnfinishedGame } from './recovery';

interface MatchRow {
  id: string;
  created_at: number;
  type: 'singles' | 'doubles';
  best_of: 1 | 3;
  first_server: Side;
  players: string;
  video_uri: string | null;
  duration_ms: number | null;
  status: 'live' | 'done';
  venue_id: string | null;
  venue_name: string | null;
  overlay_video_uri: string | null;
}

interface RallyRow {
  match_id: string;
  idx: number;
  winner: Side;
  start_ms: number | null;
  end_ms: number | null;
  shots: number | null;
  confidence: number | null;
  source: 'auto' | 'manual';
}

export interface MatchRecord {
  id: string;
  createdAt: number;
  videoUri: string | null;
  /** The video with the overlay drawn into it, once it has been exported. */
  overlayVideoUri: string | null;
  durationMs: number | null;
  status: 'live' | 'done';
  venueName: string | null;
  state: MatchState;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const toRally = (r: RallyRow): Rally => ({
  winner: r.winner,
  startMs: r.start_ms ?? undefined,
  endMs: r.end_ms ?? undefined,
  shots: r.shots ?? undefined,
  confidence: r.confidence ?? undefined,
  source: r.source,
});

function toRecord(m: MatchRow, rallies: RallyRow[]): MatchRecord {
  const config: MatchConfig = {
    type: m.type,
    bestOf: m.best_of,
    firstServer: m.first_server,
    players: JSON.parse(m.players),
  };
  return {
    id: m.id,
    createdAt: m.created_at,
    videoUri: m.video_uri,
    overlayVideoUri: m.overlay_video_uri,
    durationMs: m.duration_ms,
    status: m.status,
    venueName: m.venue_name,
    state: replay(config, rallies.sort((a, b) => a.idx - b.idx).map(toRally)),
  };
}

export async function createMatch(config: MatchConfig, venueId?: string | null): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    'INSERT INTO matches (id, created_at, type, best_of, first_server, players, venue_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, Date.now(), config.type, config.bestOf, config.firstServer, JSON.stringify(config.players), venueId ?? null,
  );
  return id;
}

/** Writes the full rally list for a match. The engine replays from this list, so it is the source of truth. */
export function saveRallies(matchId: string, rallies: Rally[]): Promise<void> {
  return inOrder(async () => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM rallies WHERE match_id = ?', matchId);
      for (let i = 0; i < rallies.length; i++) {
        const r = rallies[i];
        await db.runAsync(
          'INSERT INTO rallies (match_id, idx, winner, start_ms, end_ms, shots, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          matchId, i, r.winner, r.startMs ?? null, r.endMs ?? null, r.shots ?? null, r.confidence ?? null, r.source,
        );
      }
    });
  });
}

export async function finishMatch(matchId: string, videoUri: string | null, durationMs: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE matches SET status = 'done', video_uri = ?, duration_ms = ? WHERE id = ?", videoUri, durationMs, matchId);
}

export async function setOverlayVideo(matchId: string, uri: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE matches SET overlay_video_uri = ? WHERE id = ?', uri, matchId);
}

/**
 * Records where the video of a game in progress is being written, so it can be found again if the app is killed.
 * Pass `overlayBaked` when the file already has the overlay drawn into it.
 */
export async function setProvisionalVideo(matchId: string, uri: string, overlayBaked: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE matches SET video_uri = ?, overlay_video_uri = ? WHERE id = ?', uri, overlayBaked ? uri : null, matchId);
}

/**
 * Run once when the app starts. Finishes games that were cut off, and removes the ones that never got going.
 * `sizeOf` says how big a video file is now (0 when it is gone).
 */
export async function recoverUnfinishedGames(sizeOf: (uri: string | null) => number): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; video_uri: string | null; overlay_video_uri: string | null; n: number; last_end: number | null }>(
    `SELECT m.id AS id, m.video_uri AS video_uri, m.overlay_video_uri AS overlay_video_uri,
            (SELECT COUNT(*) FROM rallies r WHERE r.match_id = m.id) AS n,
            (SELECT MAX(r.end_ms) FROM rallies r WHERE r.match_id = m.id) AS last_end
       FROM matches m WHERE m.status = 'live'`,
  );
  const games: UnfinishedGame[] = rows.map((r) => ({ id: r.id, rallyCount: r.n, lastRallyEndMs: r.last_end, videoUri: r.video_uri, videoBytes: sizeOf(r.video_uri) }));
  const plan = planRecovery(games);
  for (const step of plan) {
    if (step.action === 'delete') {
      await db.runAsync('DELETE FROM matches WHERE id = ?', step.id);
    } else {
      const baked = rows.find((r) => r.id === step.id)?.overlay_video_uri != null && step.videoUri != null;
      await db.runAsync(
        "UPDATE matches SET status = 'done', video_uri = ?, overlay_video_uri = ?, duration_ms = ? WHERE id = ?",
        step.videoUri, baked ? step.videoUri : null, step.durationMs, step.id,
      );
    }
  }
  return plan.filter((p) => p.action === 'finish').length;
}

/** Forgets the video files of a game, for when they have been deleted to free space. The score and stats stay. */
export async function clearVideos(matchId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE matches SET video_uri = NULL, overlay_video_uri = NULL WHERE id = ?', matchId);
}

export async function listMatches(): Promise<MatchRecord[]> {
  const db = await getDb();
  const matches = await db.getAllAsync<MatchRow>(
    'SELECT m.*, v.name AS venue_name FROM matches m LEFT JOIN venues v ON v.id = m.venue_id ORDER BY m.created_at DESC',
  );
  const rallies = await db.getAllAsync<RallyRow>('SELECT * FROM rallies');
  return matches.map((m) => toRecord(m, rallies.filter((r) => r.match_id === m.id)));
}

export async function getMatch(id: string): Promise<MatchRecord | null> {
  const db = await getDb();
  const m = await db.getFirstAsync<MatchRow>(
    'SELECT m.*, v.name AS venue_name FROM matches m LEFT JOIN venues v ON v.id = m.venue_id WHERE m.id = ?', id,
  );
  if (!m) return null;
  const rallies = await db.getAllAsync<RallyRow>('SELECT * FROM rallies WHERE match_id = ?', id);
  return toRecord(m, rallies);
}

export async function deleteMatch(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM matches WHERE id = ?', id);
}

/**
 * Removes matches that were started but never got a point or a finish, for example duplicates left by an
 * earlier bug or a match abandoned by closing the app. Run at app start, when no match is being recorded.
 */
export async function purgeEmptyMatches(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM matches WHERE status = 'live' AND NOT EXISTS (SELECT 1 FROM rallies r WHERE r.match_id = matches.id)",
  );
}

export async function saveOverlay(matchId: string, data: OverlayData): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO overlays (match_id, data) VALUES (?, ?)', matchId, JSON.stringify(data));
}

export async function getOverlay(matchId: string): Promise<OverlayData | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM overlays WHERE match_id = ?', matchId);
  return row ? (JSON.parse(row.data) as OverlayData) : null;
}
