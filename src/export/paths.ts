/**
 * Where a saved file is now, given where it was saved. iOS can give an app a different data folder after an update or a restore, so the
 * full address of a video saved earlier ("file:///var/mobile/Containers/Data/Application/<OLD>/Documents/games/x.mp4") may no longer be
 * right although the file is still there, in the same place inside the new folder. The name is what lasts.
 * `gamesDir` is the games folder's address as it is now. Returns undefined when there is no name to go by.
 */
export function rebaseToFolder(uri: string | null | undefined, gamesDir: string): string | undefined {
  if (!uri) return undefined;
  const name = uri.split('?')[0].split('/').filter(Boolean).pop();
  if (!name) return undefined;
  return gamesDir.endsWith('/') ? `${gamesDir}${name}` : `${gamesDir}/${name}`;
}
