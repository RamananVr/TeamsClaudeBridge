import { describe, it, expect } from 'vitest';
import { SerialQueue } from './queue.js';

describe('SerialQueue', () => {
  it('runs tasks for the same key one at a time in order', async () => {
    const q = new SerialQueue();
    const order: number[] = [];
    const mk = (n: number, ms: number) => () => new Promise<void>(res => {
      setTimeout(() => { order.push(n); res(); }, ms);
    });
    await Promise.all([q.run('t1', mk(1, 30)), q.run('t1', mk(2, 5))]);
    expect(order).toEqual([1, 2]); // 2 waited for 1 despite being faster
  });
});
