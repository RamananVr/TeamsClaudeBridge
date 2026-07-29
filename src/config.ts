export interface Config {
  repoRoot: string;
  dbPath: string;
  appId?: string;
  appPassword?: string;
  allowedUsers: Set<string>;
}

const RELAY_SECRET_MIN_LENGTH = 32;

function parseAllowedUsers(env: Record<string, string | undefined>): Set<string> {
  const raw = (env.ALLOWED_USERS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) {
    throw new Error('ALLOWED_USERS must be non-empty — refusing to start (auto-approve mode).');
  }
  return new Set(raw);
}

function requireRelaySecret(env: Record<string, string | undefined>): string {
  const secret = env.RELAY_SHARED_SECRET ?? '';
  if (secret.length < RELAY_SECRET_MIN_LENGTH) {
    throw new Error(
      `RELAY_SHARED_SECRET must be at least ${RELAY_SECRET_MIN_LENGTH} chars — refusing to start (relay is an RCE channel).`,
    );
  }
  return secret;
}

/**
 * Legacy monolith config loader. Retained so existing behavior/tests are unchanged;
 * split-hosting uses loadContainerConfig / loadWorkerConfig instead.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    repoRoot: env.REPO_ROOT ?? '',
    dbPath: env.DB_PATH ?? './sessions.db',
    appId: env.MICROSOFT_APP_ID,
    appPassword: env.MICROSOFT_APP_PASSWORD,
    allowedUsers: parseAllowedUsers(env),
  };
}

export interface ContainerConfig {
  appId?: string;
  appType?: string;
  appTenantId?: string;
  relaySecret: string;
  allowedUsers: Set<string>;
  port: number;
}

/**
 * Config for the Azure container adapter. Keyless bot auth (UserAssignedMSI) — no
 * password. Keeps the mandatory non-empty ALLOWED_USERS guard: the container is the
 * sole Teams ingress, so this allowlist is the only gate in front of the relay.
 */
export function loadContainerConfig(env: Record<string, string | undefined> = process.env): ContainerConfig {
  const allowedUsers = parseAllowedUsers(env);
  const relaySecret = requireRelaySecret(env);
  // botbuilder's ConfigurationServiceClientCredentialFactory reads PascalCase env
  // names (MicrosoftAppId/Type/TenantId). Prefer those so the values botbuilder
  // itself consumes and the values we thread into the factory are the same source —
  // otherwise appType is undefined, botbuilder falls back to the password/secret
  // credential path, and outbound proactive sends fail with invalid_client_credential.
  return {
    appId: env.MicrosoftAppId ?? env.MICROSOFT_APP_ID,
    appType: env.MicrosoftAppType ?? env.MICROSOFT_APP_TYPE,
    appTenantId: env.MicrosoftAppTenantId ?? env.MICROSOFT_APP_TENANT_ID,
    relaySecret,
    allowedUsers,
    port: Number(env.PORT ?? 3978),
  };
}

export interface WorkerConfig {
  repoRoot: string;
  dbPath: string;
  relayUrl: string;
  relaySecret: string;
}

/**
 * Config for the devbox worker. Refuses to start without REPO_ROOT, RELAY_URL, and a
 * strong RELAY_SHARED_SECRET (defense in depth — the worker executes Claude in
 * bypassPermissions mode on the authenticated peer's behalf).
 */
export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const relaySecret = requireRelaySecret(env);
  const repoRoot = env.REPO_ROOT ?? '';
  if (!repoRoot) {
    throw new Error('REPO_ROOT must be set — refusing to start the worker.');
  }
  const relayUrl = env.RELAY_URL ?? '';
  if (!relayUrl) {
    throw new Error('RELAY_URL must be set — refusing to start the worker.');
  }
  return {
    repoRoot,
    dbPath: env.DB_PATH ?? './sessions.db',
    relayUrl,
    relaySecret,
  };
}
