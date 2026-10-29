import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** 'file:///x/y/abc.mov' -> 'abc' */
export const baseName = (uri: string): string => (uri.split('/').pop() ?? 'game').replace(/\.[^.]+$/, '');

/**
 * Opens the share sheet for the overlay file. It gets the same name as the video, so players such as VLC and IINA
 * pick it up automatically when both files are in one folder.
 */
export async function shareOverlayFile(name: string, ass: string): Promise<void> {
  const file = new File(Paths.cache, `${name}.ass`);
  file.create({ overwrite: true });
  file.write(ass);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Overlay file' });
}

export async function shareVideoFile(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType: uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4', dialogTitle: 'Game video' });
}
