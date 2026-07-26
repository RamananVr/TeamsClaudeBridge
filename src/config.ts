export interface Config {
  repoRoot: string;
  dbPath: string;
  appId?: string;
  appPassword?: string;
  allowedUsers: Set<string>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = (env.ALLOWED_USERS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) {
    throw new Error('ALLOWED_USERS must be non-empty — refusing to start (auto-approve mode).');
  }
  return {
    repoRoot: env.REPO_ROOT ?? '',
    dbPath: env.DB_PATH ?? './sessions.db',
    appId: env.MICROSOFT_APP_ID,
    appPassword: env.MICROSOFT_APP_PASSWORD,
    allowedUsers: new Set(raw),
  };
}
