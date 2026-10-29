import { describe, expect, it } from 'vitest';
import { inOrder } from './inOrder';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('inOrder', () => {
  it('never lets two jobs overlap, and keeps their order', async () => {
    let running = 0;
    let overlapped = false;
    const log: number[] = [];
    const job = (n: number, ms: number) => inOrder(async () => {
      running++;
      if (running > 1) overlapped = true;
      await sleep(ms);
      log.push(n);
      running--;
      return n;
    });
    const results = await Promise.all([job(1, 20), job(2, 1), job(3, 5)]);
    expect(overlapped).toBe(false);
    expect(log).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('carries on after a job fails', async () => {
    const failing = inOrder(async () => { throw new Error('boom'); });
    const next = inOrder(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
