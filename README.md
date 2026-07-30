# Teams ↔ Claude Code Bridge

## Overview

This bridge relays Microsoft Teams messages to [Claude Code](https://claude.com/claude-code)
sessions running against your **real local git repositories**. Each Teams thread maps to
exactly one Claude Code session, so you can start a coding task from Teams, watch Claude
make changes on disk, and keep the conversation going by replying in the same thread.

It uses **split-hosting**: a thin, keyless Bot Framework adapter runs in an Azure Container
App (the only Teams-facing ingress), and the worker — Claude Code plus your repos — runs on
your devbox. The devbox opens a single **outbound** WebSocket to the container and pulls
work; it needs **no inbound port, no public IP, and no client secret**.

## Architecture

```
Teams ──▶ Azure Bot Service ──▶ ca-tcb-adapter (Azure Container App)      devbox worker
                                 - POST /api/messages (restify)           - Claude Code (Agent SDK)
                                 - ALLOWED_USERS allowlist                 - SessionManager + sqlite
                                 - command parse, repo pick-list card      - scanRepos(REPO_ROOT)
                                 - relay WS SERVER  ◀──outbound wss──────── relay WS CLIENT
                                 - proactive send ──▶ Teams                - re-validates echoed cwd
```

- **Container (`src/index.ts`)** — restify `/api/messages`, the `ALLOWED_USERS` gate, command
  parsing, the repo card, the ConversationReference store, and the relay **WS server**.
  Bot auth is **keyless** via a User-Assigned Managed Identity (`UserAssignedMSI`) — no client
  secret, no certificate.
- **Worker (`src/worker.ts`)** — the devbox entrypoint: `SessionManager`, `ClaudeRunner`,
  SQLite session store, `scanRepos`, and the relay **WS client** that dials the container.
- **Relay** — a single authenticated WebSocket (`wss://<fqdn>/relay`). The worker authenticates
  with `RELAY_SHARED_SECRET` (constant-time exact match), then the container pushes
  prompts/scan requests and routes results back to Teams via proactive messaging.

The worker can run on any machine with the repos and an authenticated Claude Code CLI — see
[WORKER-SETUP.md](./WORKER-SETUP.md).

## Prerequisites

- **Node.js 20+** and npm on the worker machine.
- An **Azure Container App** with a **User-Assigned Managed Identity** for the adapter, and an
  **Azure Bot** registered against that identity (`msaAppType=UserAssignedMSI`).
- **Teams sideloading (custom app upload)** enabled for your account.
  > ⚠️ In a corporate tenant this is frequently disabled and may require **tenant admin
  > approval** — confirm it early.
- Claude Code CLI authenticated on the worker machine.

## Configuration

Config comes from environment variables. The code has **two loaders** — the container and the
worker read different sets. See [.env.example](./.env.example) for the copy-paste blocks.

### Worker (`loadWorkerConfig`)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `REPO_ROOT` | ✅ | — | Base directory scanned for git repos (also the `/repos` pick-list). |
| `RELAY_URL` | ✅ | — | `wss://<container-fqdn>/relay`. |
| `RELAY_SHARED_SECRET` | ✅ (≥32 chars) | — | Relay auth token; **must match the container exactly**. |
| `DB_PATH` | — | `./sessions.db` | SQLite session store path. |

### Container (`loadContainerConfig`)

| Variable | Required | Meaning |
|---|---|---|
| `MicrosoftAppId` | ✅ | Managed-identity client ID (botbuilder reads the PascalCase name). |
| `MicrosoftAppType` | ✅ | `UserAssignedMSI` (keyless auth). |
| `MicrosoftAppTenantId` | ✅ | Tenant ID for the bot. |
| `ALLOWED_USERS` | ✅ | **MANDATORY** comma-separated allowlist of Teams AAD object IDs / UPNs. |
| `RELAY_SHARED_SECRET` | ✅ (≥32 chars) | Same value as the worker. |
| `PORT` | — | Listen port (default `3978`). |

> 🔒 **`ALLOWED_USERS` is mandatory.** The container is the sole Teams ingress, and it is the
> **only** thing preventing arbitrary command execution on your devbox — Claude runs in full
> auto-approve mode, so the relay is effectively a remote-code-execution channel. The container
> **refuses to start** if `ALLOWED_USERS` is empty. Teams sends an `aadObjectId` (a GUID), so
> list that (and/or the UPN) for every allowed user — and no one else.

## Setup

### Deploy the container adapter (Azure)

1. **Provision** a User-Assigned Managed Identity, an ACR (or accessible registry), and the
   Container App. Grant the app's identity `AcrPull`.
2. **Register the Azure Bot** against the identity: `msaAppType=UserAssignedMSI`,
   `msaAppId=<UAMI clientId>`, `msaAppMSIResourceId=<UAMI resource id>`, and set the messaging
   endpoint to `https://<container-fqdn>/api/messages`. Enable the **Microsoft Teams** channel.
3. **Build & push** the adapter image (`Dockerfile` — adapter-only, never imports the worker
   modules) and point the Container App at it.
4. **Set container env**: `MicrosoftAppId`, `MicrosoftAppType=UserAssignedMSI`,
   `MicrosoftAppTenantId`, `ALLOWED_USERS`, `RELAY_SHARED_SECRET`, `PORT=3978`. Pin
   **min = max = 1 replica** — the relay/session state is in-memory per replica, so multiple
   replicas would split-brain.

### Sideload the Teams app

In `teams-app/manifest.json`, `id` and `bot.botId` must be the bot's app ID. A prebuilt
`teams-app/teams-claude-bridge.zip` (manifest + `color.png` + `outline.png`) is included; in
Teams: **Apps → Manage your apps → Upload an app → Upload a custom app**.
> ⚠️ May require **tenant admin approval** — possible blocker.

### Run the worker (devbox)

See **[WORKER-SETUP.md](./WORKER-SETUP.md)** for the full runbook (including running on a
different machine and making the worker durable). In short:

```bash
npm ci
npm rebuild better-sqlite3   # native module — build for this OS/arch
npm run build
# create .env with the worker vars (see .env.example)
npm run start:worker
```

Healthy startup logs `[worker] relay connected`. A close code **4401** means the shared secret
is wrong.

## Usage

- Start a **new thread** with the bot → it replies with a **repo pick-list card**.
- **Pick a repo** → a Claude Code session starts for that thread.
- **Reply** in the same thread to continue the conversation in that session.

Commands:

| Command    | Effect |
|------------|--------|
| `/repos`   | Show the repo pick-list again. |
| `/new`     | Start a fresh session (re-pick a repo). |
| `/end`     | End the current session for this thread. |
| `/status`  | Show the current session / repo for this thread. |

## Security

- Claude runs in **full auto-approve mode** — it can make disk changes and run commands without
  prompting. The relay is therefore an RCE channel and is defended in depth:
  - **`ALLOWED_USERS`** on the container is the primary gate; the container refuses to start with
    an empty allowlist.
  - **`RELAY_SHARED_SECRET`** (≥32 bytes, constant-time exact match, deny-by-default) authenticates
    the worker; the worker refuses to start without it, `REPO_ROOT`, and `RELAY_URL`.
  - The **repo pick-list is strict-equality validated on the worker**: it re-scans `REPO_ROOT` and
    matches the echoed `cwd` by exact path before starting a session — it never trusts the
    container's echoed path.
- Bot auth is **keyless** (Managed Identity) — no client secret or certificate to leak.
- **Secrets live only in `.env`** (gitignored) and container secrets; never commit them.

## Development

```bash
npm ci
npm test          # vitest
npm run build     # tsc → dist/
```

Two entrypoints: `npm start` (container, `dist/index.js`) and `npm run start:worker`
(devbox, `dist/worker.js`).
