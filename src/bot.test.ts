import { describe, it, expect } from 'vitest';
import { handleActivity, type BotDeps, type ActiveSession } from './bot.js';

function deps(overrides: Partial<BotDeps> & { scan?: any } = {}): BotDeps {
  const sessions = overrides.sessions ?? new Map<string, ActiveSession>();
  const scan = (overrides as any).scan ?? (async () => [{ name: 'alpha', path: 'C:/r/alpha' }]);
  const relay = overrides.relay ?? {
    sendPrompt: () => {},
    requestScan: scan,
    end: () => {},
  };
  return {
    relay,
    sessions,
    allowedUsers: overrides.allowedUsers ?? new Set(['a@m.com']),
  };
}

describe('handleActivity', () => {
  it('refuses unauthorized senders', async () => {
    const out = await handleActivity(
      { text: 'hi', conversationId: 't1', sender: { upn: 'x@m.com' }, value: undefined }, deps());
    expect(out.deferred).toBe(false);
    expect(JSON.stringify(out.replies)).toMatch(/not authorized/i);
  });

  it('shows repo card for a new thread prompt', async () => {
    const out = await handleActivity(
      { text: 'hi', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined }, deps());
    expect(out.deferred).toBe(false);
    expect(JSON.stringify(out.replies)).toMatch(/Pick a repo/);
  });

  it('starts a session on pickRepo submit and defers the starter prompt', async () => {
    const sent: any[] = [];
    const sessions = new Map<string, ActiveSession>();
    const d = deps({
      sessions,
      relay: { sendPrompt: (c, t, cwd) => sent.push({ c, t, cwd }), requestScan: async () => [{ name: 'alpha', path: 'C:/r/alpha' }], end: () => {} },
    });
    const out = await handleActivity(
      { text: '', conversationId: 't1', sender: { upn: 'a@m.com' },
        value: { action: 'pickRepo', cwd: 'C:/r/alpha', name: 'alpha' } }, d);
    expect(JSON.stringify(out.replies)).toMatch(/Started session in .*alpha/);
    expect(out.deferred).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].cwd).toBe('C:/r/alpha');
    expect(sessions.get('t1')).toEqual({ cwd: 'C:/r/alpha', name: 'alpha' });
  });

  it('forces a fresh session on pickRepo by ending any existing one first', async () => {
    const calls: string[] = [];
    const d = deps({
      relay: {
        sendPrompt: () => { calls.push('sendPrompt'); },
        requestScan: async () => [{ name: 'alpha', path: 'C:/r/alpha' }],
        end: () => { calls.push('end'); },
      },
    });
    await handleActivity(
      { text: '', conversationId: 't1', sender: { upn: 'a@m.com' },
        value: { action: 'pickRepo', cwd: 'C:/r/alpha', name: 'alpha' } }, d);
    expect(calls).toEqual(['end', 'sendPrompt']);
  });

  it('refuses a pickRepo submit whose cwd is not a scanned repo', async () => {
    let sent = false;
    const d = deps({
      relay: { sendPrompt: () => { sent = true; }, requestScan: async () => [{ name: 'alpha', path: 'C:/r/alpha' }], end: () => {} },
    });
    const out = await handleActivity(
      { text: '', conversationId: 't1', sender: { upn: 'a@m.com' },
        value: { action: 'pickRepo', cwd: 'C:/evil/path', name: 'evil' } }, d);
    expect(sent).toBe(false);
    expect(out.deferred).toBe(false);
    expect(JSON.stringify(out.replies)).toMatch(/not available/i);
  });

  it('ignores an empty/whitespace prompt on an active thread', async () => {
    let sent = false;
    const sessions = new Map<string, ActiveSession>([['t1', { cwd: 'C:/r/alpha', name: 'alpha' }]]);
    const d = deps({
      sessions,
      relay: { sendPrompt: () => { sent = true; }, requestScan: async () => [], end: () => {} },
    });
    const out = await handleActivity(
      { text: '   ', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined }, d);
    expect(sent).toBe(false);
    expect(out.deferred).toBe(false);
    expect(JSON.stringify(out.replies)).toMatch(/empty|nothing|type a message/i);
  });

  it('defers a prompt on an active thread and sends it over the relay (no cwd on continuation)', async () => {
    const sent: any[] = [];
    const sessions = new Map<string, ActiveSession>([['t1', { cwd: 'C:/r/alpha', name: 'alpha' }]]);
    const d = deps({
      sessions,
      relay: { sendPrompt: (c, t, cwd) => sent.push({ c, t, cwd }), requestScan: async () => [], end: () => {} },
    });
    const out = await handleActivity(
      { text: 'do the thing', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined }, d);
    expect(out.deferred).toBe(true);
    expect(out.replies).toEqual([]);
    expect(sent).toEqual([{ c: 't1', t: 'do the thing', cwd: undefined }]);
  });

  it('ends a session on /end and clears container state', async () => {
    const ended: string[] = [];
    const sessions = new Map<string, ActiveSession>([['t1', { cwd: 'C:/r/alpha', name: 'alpha' }]]);
    const d = deps({ sessions, relay: { sendPrompt: () => {}, requestScan: async () => [], end: (c) => ended.push(c) } });
    const out = await handleActivity(
      { text: '/end', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined }, d);
    expect(ended).toEqual(['t1']);
    expect(sessions.has('t1')).toBe(false);
    expect(JSON.stringify(out.replies)).toMatch(/ended/i);
  });

  it('reports status from container-side session state', async () => {
    const sessions = new Map<string, ActiveSession>([['t1', { cwd: 'C:/r/alpha', name: 'alpha' }]]);
    const out = await handleActivity(
      { text: '/status', conversationId: 't1', sender: { upn: 'a@m.com' }, value: undefined },
      deps({ sessions }));
    expect(JSON.stringify(out.replies)).toMatch(/alpha/);
  });
});
