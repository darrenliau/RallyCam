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
