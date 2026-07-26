# Teams ↔ Claude Code Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `development/reference/executing-plans-guide.md` to implement this plan task-by-task.

**Goal:** Build a Node.js/TypeScript bridge on the devbox that relays Microsoft Teams messages to Claude Code sessions (one per Teams thread) via Azure Bot Service, letting coding conversations start and continue from Teams.

**Architecture:** A Bot Framework SDK adapter connects outbound to a free Azure Bot Service Teams channel. Incoming Teams activities are mapped by `conversation.id` to Claude Code sessions driven through the Claude Agent SDK, with a SQLite-backed thread→session store. New threads show an adaptive-card repo pick-list; replies resume the mapped session. Sessions run in full auto-approve mode, gated by a mandatory user allowlist.

**Tech Stack:** TypeScript, Node.js, `botbuilder` (Bot Framework SDK), `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `vitest` (tests), `dotenv`.

**Reference:** See `docs/plans/2026-07-25-teams-claude-bridge-design.md` for the approved design.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`, `src/index.ts`

**Step 1: Initialize package**

Run: `npm init -y`
Then set `"type": "module"` in `package.json`.

**Step 2: Install deps**

Run:
```bash
npm i botbuilder @anthropic-ai/claude-agent-sdk better-sqlite3 dotenv restify
npm i -D typescript vitest @types/node @types/better-sqlite3 @types/restify
```

**Step 3: Add tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 4: Add .gitignore and .env.example**

`.gitignore`:
```
node_modules/
dist/
*.db
.env
```

`.env.example`:
```
REPO_ROOT=C:\Users\rarame\Repos
MICROSOFT_APP_ID=
MICROSOFT_APP_PASSWORD=
ANTHROPIC_API_KEY=
DB_PATH=./sessions.db
ALLOWED_USERS=
```

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example package-lock.json
git commit -m "chore: scaffold teams-claude-bridge project"
```

---

## Task 1: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL (module not found / loadConfig undefined)

**Step 3: Write minimal implementation**

```ts
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: config loader with mandatory allowlist guard"
```

---

## Task 2: SQLite session store

**Files:**
- Create: `src/sessionStore.ts`
- Test: `src/sessionStore.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SessionStore } from './sessionStore.js';

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
    const a = new SessionStore(path);
    a.upsert('t1', 'sess-1', 'C:/repos/x');
    a.close();
    const b = new SessionStore(path);
    expect(b.getActive('t1')?.claudeSessionId).toBe('sess-1');
    b.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sessionStore.test.ts`
Expected: FAIL (SessionStore not found)

**Step 3: Write minimal implementation**

```ts
import Database from 'better-sqlite3';

export interface SessionRow {
  teamsConversationId: string;
  claudeSessionId: string;
  cwd: string;
  status: 'active' | 'ended';
}

export class SessionStore {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        teams_conversation_id TEXT PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      )`);
  }
  getActive(threadId: string): SessionRow | undefined {
    const r = this.db.prepare(
      `SELECT * FROM sessions WHERE teams_conversation_id = ? AND status = 'active'`
    ).get(threadId) as any;
    if (!r) return undefined;
    return { teamsConversationId: r.teams_conversation_id, claudeSessionId: r.claude_session_id, cwd: r.cwd, status: r.status };
  }
  upsert(threadId: string, sessionId: string, cwd: string): void {
    const now = 1; // caller-independent; real timestamps set by DB-agnostic caller if needed
    this.db.prepare(`
      INSERT INTO sessions (teams_conversation_id, claude_session_id, cwd, status, created_at, last_activity)
      VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(teams_conversation_id) DO UPDATE SET
        claude_session_id = excluded.claude_session_id,
        cwd = excluded.cwd,
        status = 'active',
        last_activity = excluded.last_activity
    `).run(threadId, sessionId, cwd, now, now);
  }
  end(threadId: string): void {
    this.db.prepare(`UPDATE sessions SET status = 'ended' WHERE teams_conversation_id = ?`).run(threadId);
  }
  close(): void { this.db.close(); }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sessionStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessionStore.ts src/sessionStore.test.ts
git commit -m "feat: SQLite session store with active/ended lifecycle"
```

---

## Task 3: Repo scanner

**Files:**
- Create: `src/repoScanner.ts`
- Test: `src/repoScanner.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepos } from './repoScanner.js';

describe('scanRepos', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'repos-'));
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true });
    mkdirSync(join(root, 'beta', '.git'), { recursive: true });
    mkdirSync(join(root, 'not-a-repo'), { recursive: true });
  });
  it('returns only dirs containing .git', () => {
    const repos = scanRepos(root).map(r => r.name).sort();
    expect(repos).toEqual(['alpha', 'beta']);
  });
  it('returns [] for a nonexistent root', () => {
    expect(scanRepos(join(root, 'nope'))).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/repoScanner.test.ts`
Expected: FAIL (scanRepos not found)

**Step 3: Write minimal implementation**

```ts
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Repo { name: string; path: string; }

export function scanRepos(root: string): Repo[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root)
    .map(name => ({ name, path: join(root, name) }))
    .filter(r => {
      try { return statSync(r.path).isDirectory() && existsSync(join(r.path, '.git')); }
      catch { return false; }
    });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/repoScanner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repoScanner.ts src/repoScanner.test.ts
git commit -m "feat: repo scanner over configurable REPO_ROOT"
```

---

## Task 4: Command parser

**Files:**
- Create: `src/commands.ts`
- Test: `src/commands.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from './commands.js';

describe('parseCommand', () => {
  it('parses /new', () => expect(parseCommand('/new')).toEqual({ kind: 'new' }));
  it('parses /end', () => expect(parseCommand('/end')).toEqual({ kind: 'end' }));
  it('parses /status', () => expect(parseCommand('/status')).toEqual({ kind: 'status' }));
  it('parses /repos', () => expect(parseCommand('/repos')).toEqual({ kind: 'repos' }));
  it('treats other text as a prompt', () =>
    expect(parseCommand('fix the bug')).toEqual({ kind: 'prompt', text: 'fix the bug' }));
  it('trims surrounding whitespace', () =>
    expect(parseCommand('  /new  ')).toEqual({ kind: 'new' }));
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL (parseCommand not found)

**Step 3: Write minimal implementation**

```ts
export type Command =
  | { kind: 'new' } | { kind: 'end' } | { kind: 'status' }
  | { kind: 'repos' } | { kind: 'prompt'; text: string };

export function parseCommand(input: string): Command {
  const t = input.trim();
  switch (t) {
    case '/new': return { kind: 'new' };
    case '/end': return { kind: 'end' };
    case '/status': return { kind: 'status' };
    case '/repos': return { kind: 'repos' };
    default: return { kind: 'prompt', text: t };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands.ts src/commands.test.ts
git commit -m "feat: slash-command parser"
```

---

## Task 5: Authorization check

**Files:**
- Create: `src/auth.ts`
- Test: `src/auth.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isAuthorized } from './auth.js';

describe('isAuthorized', () => {
  const allowed = new Set(['a@m.com', 'aad-id-123']);
  it('allows by UPN', () => expect(isAuthorized({ upn: 'a@m.com' }, allowed)).toBe(true));
  it('allows by AAD id', () => expect(isAuthorized({ aadObjectId: 'aad-id-123' }, allowed)).toBe(true));
  it('denies unknown', () => expect(isAuthorized({ upn: 'x@m.com' }, allowed)).toBe(false));
  it('denies when no identifiers', () => expect(isAuthorized({}, allowed)).toBe(false));
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth.test.ts`
Expected: FAIL (isAuthorized not found)

**Step 3: Write minimal implementation**

```ts
export interface Sender { upn?: string; aadObjectId?: string; }

export function isAuthorized(sender: Sender, allowed: Set<string>): boolean {
  if (sender.upn && allowed.has(sender.upn)) return true;
  if (sender.aadObjectId && allowed.has(sender.aadObjectId)) return true;
  return false;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "feat: sender allowlist authorization"
```

---

## Task 6: Output truncation helper

**Files:**
- Create: `src/format.ts`
- Test: `src/format.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { truncateForTeams } from './format.js';

describe('truncateForTeams', () => {
  it('returns short text unchanged', () => {
    expect(truncateForTeams('hi', 100)).toBe('hi');
  });
  it('truncates and appends a more-lines note', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = truncateForTeams(text, 5);
    expect(out).toMatch(/…\(45 more lines\)/);
    expect(out.split('\n').length).toBeLessThanOrEqual(6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/format.test.ts`
Expected: FAIL (truncateForTeams not found)

**Step 3: Write minimal implementation**

```ts
export function truncateForTeams(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const shown = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;
  return `${shown.join('\n')}\n…(${remaining} more lines)`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/format.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts
git commit -m "feat: Teams output truncation helper"
```

---

## Task 7: Claude runner (Agent SDK wrapper)

**Files:**
- Create: `src/claudeRunner.ts`
- Test: `src/claudeRunner.test.ts`

**Step 1: Write the failing test**

Design the runner to accept an injected query function so it can be tested without the real SDK.

```ts
import { describe, it, expect } from 'vitest';
import { ClaudeRunner } from './claudeRunner.js';

describe('ClaudeRunner', () => {
  it('starts a new session and captures session id + text', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', session_id: 'sess-abc' };
      yield { type: 'assistant', text: 'done' };
    };
    const runner = new ClaudeRunner(fakeQuery as any);
    const res = await runner.run({ prompt: 'hi', cwd: 'C:/x' });
    expect(res.sessionId).toBe('sess-abc');
    expect(res.text).toContain('done');
  });
  it('passes resume session id through options', async () => {
    let seen: any;
    const fakeQuery = async function* (opts: any) {
      seen = opts;
      yield { type: 'system', session_id: 'sess-xyz' };
      yield { type: 'assistant', text: 'ok' };
    };
    const runner = new ClaudeRunner(fakeQuery as any);
    await runner.run({ prompt: 'more', cwd: 'C:/x', resumeSessionId: 'sess-xyz' });
    expect(seen.options.resume).toBe('sess-xyz');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/claudeRunner.test.ts`
Expected: FAIL (ClaudeRunner not found)

**Step 3: Write minimal implementation**

Wrap the real `query` from `@anthropic-ai/claude-agent-sdk` by default; allow injection for tests. Adapt field names to the actual SDK message shape during implementation (verify against installed SDK version).

```ts
export interface RunInput { prompt: string; cwd: string; resumeSessionId?: string; }
export interface RunResult { sessionId: string; text: string; }

type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncGenerator<any>;

export class ClaudeRunner {
  constructor(private queryFn: QueryFn) {}

  async run(input: RunInput): Promise<RunResult> {
    const options: Record<string, unknown> = {
      cwd: input.cwd,
      permissionMode: 'bypassPermissions', // full auto-approve (design decision)
    };
    if (input.resumeSessionId) options.resume = input.resumeSessionId;

    let sessionId = input.resumeSessionId ?? '';
    const parts: string[] = [];
    for await (const msg of this.queryFn({ prompt: input.prompt, options })) {
      if (msg.session_id) sessionId = msg.session_id;
      if (msg.type === 'assistant' && msg.text) parts.push(msg.text);
    }
    return { sessionId, text: parts.join('\n') };
  }
}
```

> **Implementation note:** confirm the actual Agent SDK message schema (assistant content may be a structured array, not `msg.text`) and the correct auto-approve flag name against the installed `@anthropic-ai/claude-agent-sdk` version. Adjust the extraction accordingly; keep the injected-queryFn seam for tests.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/claudeRunner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/claudeRunner.ts src/claudeRunner.test.ts
git commit -m "feat: Claude Agent SDK runner with resume + auto-approve"
```

---

## Task 8: Session manager (orchestration)

**Files:**
- Create: `src/sessionManager.ts`
- Test: `src/sessionManager.test.ts`

**Step 1: Write the failing test**

The manager ties store + runner together and decides new-vs-resume. Inject a fake runner and an in-memory store.

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sessionManager.test.ts`
Expected: FAIL (SessionManager not found)

**Step 3: Write minimal implementation**

```ts
import type { SessionStore } from './sessionStore.js';
import type { ClaudeRunner, RunResult } from './claudeRunner.js';

export class SessionManager {
  constructor(private store: SessionStore, private runner: ClaudeRunner) {}

  async handlePrompt(threadId: string, text: string, cwd?: string): Promise<RunResult> {
    const existing = this.store.getActive(threadId);
    if (!existing && !cwd) {
      throw new Error('No active session for this thread — pick a repo first.');
    }
    const res = await this.runner.run({
      prompt: text,
      cwd: existing?.cwd ?? cwd!,
      resumeSessionId: existing?.claudeSessionId,
    });
    this.store.upsert(threadId, res.sessionId, existing?.cwd ?? cwd!);
    return res;
  }

  end(threadId: string): void { this.store.end(threadId); }
  status(threadId: string) { return this.store.getActive(threadId); }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sessionManager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessionManager.ts src/sessionManager.test.ts
git commit -m "feat: session manager orchestrating new-vs-resume"
```

---

## Task 9: Repo pick-list adaptive card

**Files:**
- Create: `src/repoCard.ts`
- Test: `src/repoCard.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildRepoCard } from './repoCard.js';

describe('buildRepoCard', () => {
  it('builds one Action.Submit per repo carrying its path', () => {
    const card = buildRepoCard([{ name: 'alpha', path: 'C:/r/alpha' }]);
    const actions = (card.content as any).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('alpha');
    expect(actions[0].data).toEqual({ action: 'pickRepo', cwd: 'C:/r/alpha', name: 'alpha' });
  });
  it('shows an empty-state message when no repos', () => {
    const card = buildRepoCard([]);
    const body = (card.content as any).body;
    expect(JSON.stringify(body)).toMatch(/No repos found/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/repoCard.test.ts`
Expected: FAIL (buildRepoCard not found)

**Step 3: Write minimal implementation**

```ts
import { CardFactory, type Attachment } from 'botbuilder';
import type { Repo } from './repoScanner.js';

export function buildRepoCard(repos: Repo[]): Attachment {
  const body: any[] = [{ type: 'TextBlock', text: 'Pick a repo to start a session', weight: 'Bolder' }];
  if (repos.length === 0) {
    body.push({ type: 'TextBlock', text: 'No repos found under REPO_ROOT. Check your config.', wrap: true });
  }
  const actions = repos.map(r => ({
    type: 'Action.Submit', title: r.name, data: { action: 'pickRepo', cwd: r.path, name: r.name },
  }));
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard', version: '1.4', body, actions,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/repoCard.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/repoCard.ts src/repoCard.test.ts
git commit -m "feat: adaptive-card repo pick-list"
```

---

## Task 10: Bot activity handler

**Files:**
- Create: `src/bot.ts`
- Test: `src/bot.test.ts`

**Step 1: Write the failing test**

Handler is a pure function over a minimal activity + injected deps, returning the reply activities to send. This keeps it testable without the Bot Framework runtime.

```ts
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
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/bot.test.ts`
Expected: FAIL (handleActivity not found)

**Step 3: Write minimal implementation**

```ts
import { parseCommand } from './commands.js';
import { isAuthorized } from './auth.js';
import { buildRepoCard } from './repoCard.js';
import { truncateForTeams } from './format.js';

export interface IncomingActivity {
  text: string;
  conversationId: string;
  sender: { upn?: string; aadObjectId?: string };
  value?: any; // adaptive-card submit payload
}

export interface BotDeps {
  store: any;
  manager: any;
  scanRepos: () => { name: string; path: string }[];
  allowedUsers: Set<string>;
}

export type Reply = { text: string } | { card: any };

export async function handleActivity(a: IncomingActivity, d: BotDeps): Promise<Reply[]> {
  if (!isAuthorized(a.sender, d.allowedUsers)) {
    return [{ text: 'You are not authorized to use this bot.' }];
  }

  // Adaptive-card submit (repo selection)
  if (a.value?.action === 'pickRepo') {
    await d.manager.handlePrompt(a.conversationId, 'Session started. What should I work on?', a.value.cwd);
    return [{ text: `Started session in \`${a.value.name}\`. Send your next message to continue.` }];
  }

  const cmd = parseCommand(a.text ?? '');
  switch (cmd.kind) {
    case 'repos':
    case 'new':
      return [{ card: buildRepoCard(d.scanRepos()) }];
    case 'end':
      d.manager.end(a.conversationId);
      return [{ text: 'Session ended.' }];
    case 'status': {
      const s = d.manager.status(a.conversationId);
      return [{ text: s ? `Active session in \`${s.cwd}\` (id ${s.claudeSessionId}).` : 'No active session.' }];
    }
    case 'prompt': {
      const active = d.store.getActive(a.conversationId);
      if (!active) return [{ card: buildRepoCard(d.scanRepos()) }];
      const res = await d.manager.handlePrompt(a.conversationId, cmd.text);
      return [{ text: truncateForTeams(res.text, 60) }];
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot.ts src/bot.test.ts
git commit -m "feat: bot activity handler (auth, pick-list, commands, prompts)"
```

---

## Task 11: Per-thread serial queue

**Files:**
- Create: `src/queue.ts`
- Test: `src/queue.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/queue.test.ts`
Expected: FAIL (SerialQueue not found)

**Step 3: Write minimal implementation**

```ts
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.tails.set(key, next.catch(() => {}));
    return next;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/queue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/queue.ts src/queue.test.ts
git commit -m "feat: per-thread serial queue"
```

---

## Task 12: Bot Framework wiring + entrypoint

**Files:**
- Create: `src/index.ts`, `src/adapter.ts`
- Modify: `package.json` (add `start`/`dev` scripts)

**Step 1: Wire the Bot Framework adapter**

`src/adapter.ts` — build a `CloudAdapter` + `ActivityHandler` that:
- extracts `{ text, conversation.id, from.aadObjectId/UPN, value }` from the Turn context into an `IncomingActivity`,
- runs it through `SerialQueue.run(conversationId, () => handleActivity(...))`,
- sends each `Reply` (text or `CardFactory` attachment) via `context.sendActivity`.

`src/index.ts` — `loadConfig()`, construct `SessionStore`, `ClaudeRunner(query)` (real Agent SDK), `SessionManager`, then start a `restify` server exposing `/api/messages` bound to the adapter. Log every inbound message + sender (audit).

> **Note:** With the outbound Azure Bot streaming/Direct Line model the devbox needs no public inbound port; for initial local testing the Bot Framework Emulator can hit `/api/messages` directly. Confirm the outbound connection wiring against current Bot Framework SDK docs during implementation.

**Step 2: Add scripts to package.json**

```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "node --loader ts-node/esm src/index.ts",
  "test": "vitest run"
}
```

**Step 3: Typecheck + full test run**

Run: `npm run build && npm test`
Expected: build succeeds, all unit/integration tests PASS.

**Step 4: Commit**

```bash
git add src/index.ts src/adapter.ts package.json
git commit -m "feat: Bot Framework adapter wiring and entrypoint"
```

---

## Task 13: Azure Bot + Teams manifest (infra, manual)

**Files:**
- Create: `teams-app/manifest.json`, `teams-app/color.png`, `teams-app/outline.png`, `README.md` (setup steps)

**Steps (documented, executed manually by the user):**

1. In sub `e0b3fc49-3365-47b8-946b-ad9adea3fdbe`: create an **Azure Bot** resource + **Entra App Registration**; capture `MICROSOFT_APP_ID` / `MICROSOFT_APP_PASSWORD` into `.env`.
2. Enable the **Microsoft Teams** channel on the bot.
3. Fill `teams-app/manifest.json` with the bot id, scopes (`personal`, `team`), and package into a zip with the two icons.
4. **Sideload** the app into Teams (may require tenant admin approval — flag as a possible blocker).
5. Run `npm start` on the devbox; verify a Teams message reaches the bot and a reply returns.

**Commit:**

```bash
git add teams-app README.md
git commit -m "docs: Azure Bot + Teams manifest and setup guide"
```

---

## Task 14: End-to-end verification

**Manual checklist (no code):**
- New thread → repo pick-list appears → select repo → "Started session" ack.
- Send a coding prompt → Claude makes a change on disk in the selected repo → reply lands in the same thread.
- Reply again → same session resumed (verify continuity).
- `/status` shows correct repo + session id.
- `/end` ends; next prompt re-shows pick-list.
- Unauthorized user → refused.
- Restart bridge → `/status` still resolves the session (SQLite persistence).
- Long output → truncated with "…(N more lines)".

Record results in `README.md` under a "Verification" section and commit.

---

## Notes for the implementer

- **DRY / YAGNI:** no multi-user locking, dashboard, or reactions in v1.
- **TDD:** every logic module has tests first; infra (Tasks 12–14) is wiring/manual and verified via build + e2e.
- **SDK schema risk:** Task 7 depends on the real `@anthropic-ai/claude-agent-sdk` message shape and auto-approve flag — verify against the installed version and adjust extraction; keep the injected-`queryFn` seam.
- **Security:** the allowlist is the only thing between a Teams message and arbitrary command execution on the devbox — never disable the empty-allowlist guard.
