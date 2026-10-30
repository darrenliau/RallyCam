import { describe, expect, it } from 'vitest';
import { parseTracknetCsv } from './tracknetCsv';

describe('parseTracknetCsv', () => {
  const csv = 'Frame,Visibility,X,Y\n0,0,0,0\n1,1,100.5,200\n2,1,110,205\n3,0,0,0\n';
  it('keeps the frames where the shuttle was seen, as both candidate and track', () => {
    const rows = parseTracknetCsv(csv, 60);
    expect(rows).toHaveLength(4);
    expect(rows[0].track).toBeUndefined();
    expect(rows[1].track).toEqual({ x: 100.5, y: 200 });
    expect(rows[1].boxes).toEqual([{ x: 100.5, y: 200 }]);
    expect(rows[2].t).toBeCloseTo(2 / 60, 9);
  });
  it('pads to the clip length when it is given', () => {
    expect(parseTracknetCsv(csv, 60, 10)).toHaveLength(10);
  });
  it('ignores a "seen" row at 0,0, which is how some versions write a miss', () => {
    expect(parseTracknetCsv('Frame,Visibility,X,Y\n0,1,0,0\n', 60)[0].track).toBeUndefined();
  });
  it('rejects a file that is not a TrackNet CSV', () => {
    expect(() => parseTracknetCsv('a,b\n1,2\n', 60)).toThrow();
  });
});
