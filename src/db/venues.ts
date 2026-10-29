import type { Corners } from '../analysis/court';
import { getDb } from './db';

export interface Venue {
  id: string;
  name: string;
  /** Court corners as fractions of the screen, or null until the user has aligned the court here. */
  corners: Corners | null;
  /** Screen width / height when the corners were saved. A different phone shape means the corners may be off. */
  aspect: number | null;
  lastUsedAt: number;
}

interface VenueRow { id: string; name: string; corners: string | null; aspect: number | null; last_used_at: number }

const toVenue = (r: VenueRow): Venue => ({
  id: r.id,
  name: r.name,
  corners: r.corners ? JSON.parse(r.corners) : null,
  aspect: r.aspect,
  lastUsedAt: r.last_used_at,
});

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function listVenues(): Promise<Venue[]> {
  const db = await getDb();
  return (await db.getAllAsync<VenueRow>('SELECT * FROM venues ORDER BY last_used_at DESC')).map(toVenue);
}

export async function getVenue(id: string): Promise<Venue | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<VenueRow>('SELECT * FROM venues WHERE id = ?', id);
  return r ? toVenue(r) : null;
}

export async function createVenue(name: string): Promise<Venue> {
  const db = await getDb();
  const id = newId();
  const now = Date.now();
  await db.runAsync('INSERT INTO venues (id, name, last_used_at) VALUES (?, ?, ?)', id, name, now);
  return { id, name, corners: null, aspect: null, lastUsedAt: now };
}

export async function renameVenue(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE venues SET name = ? WHERE id = ?', name, id);
}

export async function saveVenueCorners(id: string, corners: Corners, aspect: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE venues SET corners = ?, aspect = ? WHERE id = ?', JSON.stringify(corners), aspect, id);
}

export async function touchVenue(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE venues SET last_used_at = ? WHERE id = ?', Date.now(), id);
}

/** Matches played here keep their record; they just lose the venue link. */
export async function deleteVenue(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM venues WHERE id = ?', id);
}
