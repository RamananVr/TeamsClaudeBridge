import { describe, it, expect, vi } from 'vitest';
import { makeMessagesHandler } from './httpHandler.js';

describe('makeMessagesHandler', () => {
  it('is async so restify accepts it as a 2-arg handler (guards ERR_ASSERTION crash-loop)', () => {
    const handler = makeMessagesHandler({ process: vi.fn() } as any, vi.fn());
    // Restify throws ERR_ASSERTION at route registration for a non-async
    // handler with fewer than 3 args — exactly what crash-looped the container.
    expect(handler.constructor.name).toBe('AsyncFunction');
    expect(handler.length).toBeLessThanOrEqual(2);
  });

  it('delegates to adapter.process with req, res, and a logic-invoking callback', async () => {
    const process = vi.fn(async (_req, _res, cb) => { await cb('ctx'); });
    const logic = vi.fn(async () => {});
    const handler = makeMessagesHandler({ process } as any, logic);
    await handler({ m: 'req' }, { m: 'res' });
    expect(process).toHaveBeenCalledWith({ m: 'req' }, { m: 'res' }, expect.any(Function));
    expect(logic).toHaveBeenCalledWith('ctx');
  });
});
