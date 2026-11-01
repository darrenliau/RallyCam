import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './base64';

describe('decodeBase64', () => {
  const enc = (bytes: number[]) => Buffer.from(bytes).toString('base64');
  it('decodes text of every length remainder', () => {
    for (const bytes of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]) {
      expect(Array.from(decodeBase64(enc(bytes)))).toEqual(bytes);
    }
  });
  it('decodes a long run of every byte value', () => {
    const bytes = Array.from({ length: 5000 }, (_, i) => (i * 37) % 256);
    expect(Array.from(decodeBase64(enc(bytes)))).toEqual(bytes);
  });
  it('ignores line breaks', () => {
    expect(Array.from(decodeBase64('AQID\nBAUG'))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
