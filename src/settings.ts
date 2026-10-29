import { useEffect, useState } from 'react';
import { getDb } from './db/db';
import { DEFAULT_SETTINGS, parseSetting, type Settings } from './settingsModel';

export * from './settingsModel';

const serialise = (v: unknown): string => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

let cache: Settings = DEFAULT_SETTINGS;
let loaded: Promise<Settings> | null = null;
let isLoaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function loadSettings(): Promise<Settings> {
  loaded ??= (async () => {
    const db = await getDb();
    const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
    const next: Settings = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      const key = r.key as keyof Settings;
      if (!(key in DEFAULT_SETTINGS)) continue;
      const value = parseSetting(key, r.value);
      if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
    }
    cache = next;
    isLoaded = true;
    notify();
    return cache;
  })();
  return loaded;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await loadSettings();
  cache = { ...cache, ...patch };
  notify();
  const db = await getDb();
  for (const [key, value] of Object.entries(patch)) {
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, serialise(value));
  }
}

/** The saved settings, and whether they have been read from the database yet. */
export function useSettings(): Settings & { ready: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    loadSettings().then(l);
    return () => { listeners.delete(l); };
  }, []);
  return { ...cache, ready: isLoaded };
}
