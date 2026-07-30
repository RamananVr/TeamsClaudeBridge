# Teams ↔ Claude Code Bridge — Design

**Date:** 2026-07-25
**Status:** Approved (design phase)

## Summary

An interactive Microsoft Teams chat bot that relays messages to Claude Code
CLI sessions running on the user's always-on **devbox**, so a coding
conversation can be started and continued from a Teams chat or channel thread.
Each Teams thread maps to one persistent Claude Code session working on the
user's real local repositories.

## Goals

- Start a **new** Claude Code coding session from Teams.
- **Continue** an existing session by replying in the same Teams thread.
- Sessions run on the devbox against **real local repos**.
- Connectivity requires **no inbound port** on the devbox.

## Non-Goals (v1 — YAGNI)

- Multi-user parallel-repo locking / coordination.
- Web dashboard, message editing/reactions, voice.
- Hosting on a separate server (devbox only).

## Requirements (captured during brainstorming)

- Claude Code endpoint = **running CLI sessions on the devbox** (option 1),
  with ability to start new sessions.
- Host = **devbox**, always on (has real repos + local file access).
- Connectivity = **Azure Bot Service, outbound** connection (free Teams
  channel, no inbound firewall exposure).
- Session mapping = **one session per Teams chat/thread**; reply continues it.
- Driver = **Claude Agent SDK** (headless/programmatic), not TUI scraping.
- Repo selection = **always a pick-list** (adaptive card), no free-text.
- Repo root = **configurable** (`REPO_ROOT`).
- Permission mode = **full auto-approve** (mandatory user allowlist as the
  primary safeguard).

## Cost & Environment

- Azure Bot + Teams channel: **$0** (Teams is a free standard channel).
- Hosting: devbox, already running: **$0 new**.
- Real cost: **Anthropic token usage** (same as running Claude Code today).
- Azure subscription: **TestTRS01** =
  `e0b3fc49-3365-47b8-946b-ad9adea3fdbe` (tenant
  `72f988bf-86f1-41af-91ab-2d7cd011db47`, `rarame@microsoft.com`).
- **Policy risk (not cost):** custom Teams app **sideloading** may be
  restricted on the corp tenant and could require an admin/IT request. Also
  App Registration creation must be permitted.

## Architecture

```
Teams chat/channel
   │  message
   ▼
Azure Bot Service (free Teams channel)
   ▲  outbound streaming / Direct Line (no inbound port on devbox)
   ▼
Bridge Service (devbox, Node.js/TypeScript)
   • Bot adapter (Bot Framework SDK) — receives Teams activities
   • Session manager — Teams conversation.id → { sessionId, cwd, status }
   • Claude runner — Claude Agent SDK: start new / resume by sessionId
   • Persistence — SQLite (thread→session map, survives restart)
   │  spawns / resumes
   ▼
Claude Code session (Agent SDK, cwd = selected repo, real local repos)
```

**Flow:**
1. User sends/replies in a Teams thread; Azure Bot forwards the activity.
2. Bridge receives it over an **outbound** connection (no inbound port).
3. Bridge looks up `conversation.id`:
   - Not found → post repo pick-list card → on selection, start Agent SDK
     session, store `threadId → {sessionId, cwd}`.
   - Found → resume `sessionId`, submit message as next turn.
4. Claude Code runs on real local repos; result streamed back as a threaded
   reply.

## Components

### 1. Bot registration (Azure)
- **Azure Bot** resource in sub `e0b3fc49-...` + **Entra App Registration**
  (client id + secret).
- **Microsoft Teams** channel enabled.
- **Teams app manifest** (`manifest.json` + icons, zipped) for install.

### 2. Bridge Service (devbox, Node.js/TypeScript)
- **Bot adapter layer** — Bot Framework SDK, connects **outbound** to Azure
  Bot Service; handles Teams threads, mentions, adaptive cards.
- **Session manager** — maps `conversation.id` → session row; create /
  resume / end.
- **Claude runner** — wraps **Claude Agent SDK**; new session or resume by
  `sessionId`; streams assistant/tool events.
- **Persistence** — **SQLite** for the session map (durable, tiny).

### 3. Claude Code sessions
- One per thread, each with a `cwd` (repo). Uses existing devbox Claude Code
  config/auth. Full auto-approve permission mode.

## Data Model

SQLite table `sessions`:

| column                  | meaning                              |
|-------------------------|--------------------------------------|
| `teams_conversation_id` | PK — Teams thread/chat id            |
| `claude_session_id`     | Agent SDK session id to resume       |
| `cwd`                   | repo path on devbox                  |
| `status`                | `active` / `ended`                   |
| `created_at`            | timestamp                            |
| `last_activity`         | timestamp                            |

## Session Lifecycle

**Start (new thread or `/new`):**
1. No `active` row for the thread.
2. Scan configured **`REPO_ROOT`** for git repos.
3. Post an **adaptive card pick-list** of repos as buttons (always pick-list;
   no free-text repo names).
4. On selection → start Agent SDK session with that `cwd`, store row, ack
   ("Started session in `repo-x`").

**Continue (reply in thread):**
1. `active` row found → resume `claude_session_id`, submit text as next turn.
2. Stream assistant text back as threaded reply; long/tool output rendered as
   adaptive cards or trimmed code blocks.

**Commands (minimal set):**
- `/new` — force a new session (re-shows pick-list)
- `/end` — mark session ended
- `/status` — show current session's repo + id
- `/repos` — list available repos

**Concurrency:** per-thread turns queued serially (one turn at a time per
session); different threads run in parallel.

## Configuration

- `REPO_ROOT` — base dir to scan for repos (e.g. `C:\Users\rarame\Repos`).
- `MICROSOFT_APP_ID` / `MICROSOFT_APP_PASSWORD` — bot auth.
- `ANTHROPIC_API_KEY` (or existing devbox Claude Code auth).
- `DB_PATH` — SQLite file location.
- `ALLOWED_USERS` — allowlist of Teams AAD ids / UPNs (**mandatory**).

## Error Handling

- **Claude run fails/crashes** → catch, post error to thread, mark session
  recoverable; next message retries resume, else offers `/new`.
- **Bridge restart** → SQLite persists map; resume by id on next message.
  In-flight turn lost (user re-sends).
- **Repo scan empty / bad root** → clear message to fix `REPO_ROOT`.
- **Long output / Teams size limits** → truncate with "…(N more lines)"
  and/or attach as file/card; never silently drop.
- **Concurrent messages in a thread** → queued serially; post "working…".

## Security

Claude Code runs with the devbox user's permissions on real repos, in **full
auto-approve** mode — so any message from an allowed user can run any command
unattended. Mitigations:

- **Authorized-user allowlist (mandatory)** — bridge checks sender AAD
  id/UPN against `ALLOWED_USERS`; refuses everyone else. Bridge **refuses to
  start** if the allowlist is empty.
- **Secrets** — bot password + API key in env/secret store, never in repo.
- **Audit log** — every inbound message + sender + session/repo logged
  locally.

## Testing

**Unit:**
- Session manager: new/resume/end transitions, mapping, SQLite persistence
  across restart.
- Repo scanner: correct git repos for a `REPO_ROOT`; empty/invalid handling.
- Allowlist check: allowed vs denied senders.
- Command parser: `/new`, `/end`, `/status`, `/repos`.

**Integration (mock Teams adapter + stub Agent SDK):**
- Message → new session → pick-list card → selection → session created.
- Reply → resumes correct session id.
- Long output truncation.
- Unauthorized sender refused.

**Manual end-to-end:**
- Real bot in Teams → real Agent SDK on devbox: start session, pick repo,
  make a code change, continue in-thread, `/end`. Verify replies land in the
  right thread and files change on disk.
