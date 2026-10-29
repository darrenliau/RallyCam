import { Directory, File, Paths } from 'expo-file-system';

/**
 * Moves a file into the app's documents folder. The cache and temp folders can be emptied by iOS when space is low,
 * and the camera writes its video to a temp folder. Returns the new uri, or the old one if the move failed.
 */
export function keepFile(uri: string, name: string): string {
  try {
    const dir = new Directory(Paths.document, 'games');
    if (!dir.exists) dir.create();
    const dest = new File(dir, name);
    if (dest.exists) dest.delete();
    new File(uri).move(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

export const extensionOf = (uri: string, fallback = 'mov'): string => {
  const m = /\.([A-Za-z0-9]+)$/.exec(uri.split('?')[0]);
  return m ? m[1].toLowerCase() : fallback;
};

export const formatBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`;

/** Free space on the phone, in bytes. */
export function freeSpaceBytes(): number {
  try { return Paths.availableDiskSpace; } catch { return Number.POSITIVE_INFINITY; }
}

/** Size of one file in bytes, or 0 if it is gone. */
export function fileBytes(uri: string | null | undefined): number {
  if (!uri) return 0;
  try {
    const f = new File(uri);
    return f.exists ? (f.size ?? 0) : 0;
  } catch { return 0; }
}

export function fileExists(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try { return new File(uri).exists; } catch { return false; }
}

/** Deletes a file if it exists. Returns whether something was deleted. */
export function removeFile(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const f = new File(uri);
    if (!f.exists) return false;
    f.delete();
    return true;
  } catch { return false; }
}

/** Total size of the videos RallyCam keeps, and how many there are. */
export function videosFolderStats(): { bytes: number; count: number } {
  try {
    const dir = new Directory(Paths.document, 'games');
    if (!dir.exists) return { bytes: 0, count: 0 };
    let bytes = 0;
    let count = 0;
    for (const item of dir.list()) {
      if (item instanceof File) { bytes += item.size ?? 0; count += 1; }
    }
    return { bytes, count };
  } catch { return { bytes: 0, count: 0 }; }
}

/** A new file in the games folder, where the camera can write a video that survives the app being killed. */
export function newGameVideoFile(extension = 'mp4'): File {
  const dir = new Directory(Paths.document, 'games');
  if (!dir.exists) dir.create();
  return new File(dir, `game-${Date.now()}.${extension}`);
}

/** A new CSV file next to the game videos, for the shuttle tracker's log. */
export function newShuttleLogFile(): File {
  const dir = new Directory(Paths.document, 'games');
  if (!dir.exists) dir.create();
  return new File(dir, `game-${Date.now()}.shuttle.csv`);
}

/** Where the shuttle log of a finished game is kept. */
export function shuttleLogUriFor(matchId: string): string {
  return new File(new Directory(Paths.document, 'games'), `${matchId}.shuttle.csv`).uri;
}
