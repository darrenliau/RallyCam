import { describe, expect, it } from 'vitest';
import { rebaseToFolder } from './paths';

const NOW = 'file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/games/';

describe('rebaseToFolder', () => {
  it('puts a video saved under an old data folder into the current games folder', () => {
    expect(rebaseToFolder('file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/games/game-1730000000000.mp4', NOW)).toBe(`${NOW}game-1730000000000.mp4`);
  });
  it('works with a games folder address that has no trailing slash, and with a query string', () => {
    expect(rebaseToFolder('file:///old/games/a%20b.mp4?x=1', NOW.slice(0, -1))).toBe(`${NOW}a%20b.mp4`);
  });
  it('gives the same address back for a file that is already in the current folder', () => {
    expect(rebaseToFolder(`${NOW}x.mp4`, NOW)).toBe(`${NOW}x.mp4`);
  });
  it('gives nothing when there is no name', () => {
    expect(rebaseToFolder(null, NOW)).toBeUndefined();
    expect(rebaseToFolder('', NOW)).toBeUndefined();
    expect(rebaseToFolder('///', NOW)).toBeUndefined();
  });
});
