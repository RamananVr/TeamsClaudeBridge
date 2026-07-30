import { describe, it, expect } from 'vitest';
import { SessionManager } from './sessionManager.js';
import { SessionStore } from './sessionStore.js';

function fakeRunner() {
  const calls: any[] = [];
  return {
    calls,
    run: async (input: any) => {
      calls.push(input);
      return { sessionId: input.resumeSessionId ?? 'new-sess', text: 'reply' };
    },
  };
}

describe('SessionManager', () => {
  it('starts a new session when thread unknown', async () => {
    const store = new SessionStore(':memory:');
    const runner = fakeRunner();
    const mgr = new SessionManager(store, runner as any);
    const res = await mgr.handlePrompt('t1', 'hello', 'C:/repos/x');
    expect(res.text).toBe('reply');
    expect(runner.calls[0].resumeSessionId).toBeUndefined();
    expect(store.getActive('t1')?.claudeSessionId).toBe('new-sess');
  });
  it('resumes an existing session', async () => {
    const store = new SessionStore(':memory:');
    store.upsert('t1', 'sess-1', 'C:/repos/x');
    const runner = fakeRunner();
    const mgr = new SessionManager(store, runner as any);
    await mgr.handlePrompt('t1', 'again', 'C:/repos/x');
    expect(runner.calls[0].resumeSessionId).toBe('sess-1');
  });
  it('throws if prompting a thread with no active session and no cwd', async () => {
    const store = new SessionStore(':memory:');
    const mgr = new SessionManager(store, fakeRunner() as any);
    await expect(mgr.handlePrompt('t1', 'hi')).rejects.toThrow(/no active session/i);
  });
});
