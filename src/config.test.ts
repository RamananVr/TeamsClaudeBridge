import { describe, it, expect } from 'vitest';
import { loadConfig, loadContainerConfig, loadWorkerConfig } from './config.js';

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

const SECRET = 'x'.repeat(32);

describe('loadContainerConfig', () => {
  const base = { ALLOWED_USERS: 'a@m.com', RELAY_SHARED_SECRET: SECRET };
  it('throws when ALLOWED_USERS is empty (guard preserved)', () => {
    expect(() => loadContainerConfig({ ...base, ALLOWED_USERS: '' })).toThrow(/ALLOWED_USERS/);
  });
  it('throws when RELAY_SHARED_SECRET is missing', () => {
    expect(() => loadContainerConfig({ ALLOWED_USERS: 'a@m.com' })).toThrow(/RELAY_SHARED_SECRET/);
  });
  it('throws when RELAY_SHARED_SECRET is too short', () => {
    expect(() => loadContainerConfig({ ...base, RELAY_SHARED_SECRET: 'short' })).toThrow(/RELAY_SHARED_SECRET/);
  });
  it('parses MSI fields and allowlist', () => {
    const c = loadContainerConfig({
      ...base,
      MICROSOFT_APP_ID: 'app-id', MICROSOFT_APP_TYPE: 'UserAssignedMSI', MICROSOFT_APP_TENANT_ID: 'tid',
    });
    expect(c.appId).toBe('app-id');
    expect(c.appType).toBe('UserAssignedMSI');
    expect(c.appTenantId).toBe('tid');
    expect(c.relaySecret).toBe(SECRET);
    expect(c.allowedUsers.has('a@m.com')).toBe(true);
  });
  it('reads botbuilder PascalCase env names (as set on the container)', () => {
    const c = loadContainerConfig({
      ...base,
      MicrosoftAppId: 'app-id', MicrosoftAppType: 'UserAssignedMSI', MicrosoftAppTenantId: 'tid',
    });
    expect(c.appId).toBe('app-id');
    expect(c.appType).toBe('UserAssignedMSI');
    expect(c.appTenantId).toBe('tid');
  });
  it('prefers PascalCase over underscore when both are set (avoids stale/wrong values)', () => {
    const c = loadContainerConfig({
      ...base,
      MICROSOFT_APP_TENANT_ID: 'wrong-tenant', MicrosoftAppTenantId: 'right-tenant',
    });
    expect(c.appTenantId).toBe('right-tenant');
  });
});

describe('loadWorkerConfig', () => {
  const base = { REPO_ROOT: 'C:/r', RELAY_URL: 'wss://host/relay', RELAY_SHARED_SECRET: SECRET };
  it('throws when RELAY_SHARED_SECRET is missing', () => {
    expect(() => loadWorkerConfig({ REPO_ROOT: 'C:/r', RELAY_URL: 'wss://host/relay' })).toThrow(/RELAY_SHARED_SECRET/);
  });
  it('throws when REPO_ROOT is missing', () => {
    expect(() => loadWorkerConfig({ RELAY_URL: 'wss://host/relay', RELAY_SHARED_SECRET: SECRET })).toThrow(/REPO_ROOT/);
  });
  it('throws when RELAY_URL is missing', () => {
    expect(() => loadWorkerConfig({ REPO_ROOT: 'C:/r', RELAY_SHARED_SECRET: SECRET })).toThrow(/RELAY_URL/);
  });
  it('parses worker fields', () => {
    const c = loadWorkerConfig(base);
    expect(c.repoRoot).toBe('C:/r');
    expect(c.relayUrl).toBe('wss://host/relay');
    expect(c.relaySecret).toBe(SECRET);
    expect(c.dbPath).toBe('./sessions.db');
  });
});
