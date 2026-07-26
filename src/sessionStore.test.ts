import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { SessionStore } from './sessionStore.js';

const tempDbs: string[] = [];

afterEach(() => {
  for (const p of tempDbs.splice(0)) {
    if (existsSync(p)) rmSync(p, { force: true });
  }
});

describe('SessionStore', () => {
  it('returns undefined for unknown thread', () => {
    const s = new SessionStore(':memory:');
    expect(s.getActive('t1')).toBeUndefined();
  });
  it('creates and retrieves an active session', () => {
    const s = new SessionStore(':memory:');
    s.upsert('t1', 'sess-1', 'C:/repos/x');
    const row = s.getActive('t1');
    expect(row?.claudeSessionId).toBe('sess-1');
    expect(row?.cwd).toBe('C:/repos/x');
    expect(row?.status).toBe('active');
  });
  it('ends a session so it is no longer active', () => {
    const s = new SessionStore(':memory:');
    s.upsert('t1', 'sess-1', 'C:/repos/x');
    s.end('t1');
    expect(s.getActive('t1')).toBeUndefined();
  });
  it('persists across reopen', () => {
    const path = `./test-${Date.now()}.db`;
    tempDbs.push(path);
    const a = new SessionStore(path);
    a.upsert('t1', 'sess-1', 'C:/repos/x');
    a.close();
    const b = new SessionStore(path);
    expect(b.getActive('t1')?.claudeSessionId).toBe('sess-1');
    b.close();
  });
});
