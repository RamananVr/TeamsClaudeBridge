import { describe, it, expect } from 'vitest';
import { handleActivity } from './bot.js';
import { SessionStore } from './sessionStore.js';

function deps(overrides: any = {}) {
  return {
    store: new SessionStore(':memory:'),
    manager: { handlePrompt: async () => ({ sessionId: 's', text: 'ok' }), end() {}, status() { return undefined; } },
    scanRepos: () => [{ name: 'alpha', path: 'C:/r/alpha' }],
    allowedUsers: new Set(['a@m.com']),
    ...overrides,
  };
}

describe('handleActivity', () => {
  it('refuses unauthorized senders', async () => {
    const out = await handleActivity(
      { text: 'hi', conversationId: 't1', sender: { upn: 'x@m.com' }, value: undefined }, deps());
    expect(JSON.stringify(out)).toMatch(/not authorized/i);
  });
  it('shows repo card for a new thread prompt', async () => {
    const out = await handleActivity(
      { text: 'hi', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined }, deps());
    expect(JSON.stringify(out)).toMatch(/Pick a repo/);
  });
  it('starts a session on pickRepo submit', async () => {
    const d = deps();
    const out = await handleActivity(
      { text: '', conversationId: 't1', sender: { upn: 'a@m.com' },
        value: { action: 'pickRepo', cwd: 'C:/r/alpha', name: 'alpha' } }, d);
    expect(JSON.stringify(out)).toMatch(/Started session in .*alpha/);
  });
  it('ignores an empty/whitespace prompt on an active thread', async () => {
    const store = new SessionStore(':memory:');
    store.upsert('t1', 'sess-1', 'C:/r/alpha');
    let called = false;
    const manager = { handlePrompt: async () => { called = true; return { sessionId: 's', text: 'ok' }; }, end() {}, status() { return undefined; } };
    const out = await handleActivity(
      { text: '   ', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined },
      deps({ store, manager }));
    expect(called).toBe(false);
    expect(JSON.stringify(out)).toMatch(/empty|nothing|type a message/i);
  });
});
