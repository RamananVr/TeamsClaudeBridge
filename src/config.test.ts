import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws when ALLOWED_USERS is empty', () => {
    expect(() => loadConfig({ REPO_ROOT: 'x', DB_PATH: 'y', ALLOWED_USERS: '' }))
      .toThrow(/ALLOWED_USERS/);
  });
  it('parses allowed users into a set', () => {
    const c = loadConfig({ REPO_ROOT: 'x', DB_PATH: 'y', ALLOWED_USERS: 'a@m.com, b@m.com' });
    expect(c.allowedUsers.has('a@m.com')).toBe(true);
    expect(c.allowedUsers.has('b@m.com')).toBe(true);
  });
});
