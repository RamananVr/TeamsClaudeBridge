# Worker Setup — running the devbox worker (incl. on a different machine)

The **worker** is the devbox half of the split-hosting bridge. It dials an
**outbound** WebSocket to the Azure container (`wss://<fqdn>/relay`), pulls
prompts, runs Claude Code against real local repos, and pushes results back. It
needs **no inbound ports, no public IP, no firewall changes** — only outbound
443.

Because the transport is outbound and container-agnostic, the worker can run on
any machine that has (a) the repos you want to reach and (b) an authenticated
Claude Code CLI. The container does not know or care which machine the worker
runs on; it accepts exactly **one** authenticated relay socket at a time.

> **Security note.** The worker runs Claude Code in `bypassPermissions` mode, so
> the relay is effectively a remote-code-execution channel into whatever
> `REPO_ROOT` points at. It is gated only by `RELAY_SHARED_SECRET` (relay auth)
> and the container's `ALLOWED_USERS` allowlist. Only run the worker on a machine
> you trust, under an account you control. Never run it on shared infrastructure
> without understanding this.

---

## What the worker needs on any host

| Requirement | Why | Notes |
|---|---|---|
| **Node.js 20+** | it's a Node process | `node --version` ≥ v20 |
| **The built `dist/`** | the entrypoint is `node dist/worker.js` | ship `dist/`, or clone + `npm ci && npm run build` |
| **Claude Code CLI, authenticated** | worker spawns Claude in bypassPermissions | one-time interactive login on the host — see below |
| **`REPO_ROOT`** pointing at real repos | what Claude operates on; also the `/repos` pick-list | the repos must actually exist on this machine |
| **`RELAY_URL`** | where to dial | `wss://ca-tcb-adapter.mangopond-4a6e3187.eastus2.azurecontainerapps.io/relay` |
| **`RELAY_SHARED_SECRET`** | relay auth — must match the container's secret exactly | ≥32 chars; keep it out of git |
| **`better-sqlite3` for this OS/arch** | session store (native module) | `npm rebuild better-sqlite3` on the target platform |

### Worker config contract

`loadWorkerConfig` (`src/config.ts`) reads exactly these env vars and **refuses
to start** if any of the required ones is missing:

| Var | Required | Default | Purpose |
|---|---|---|---|
| `REPO_ROOT` | ✅ | — | root dir scanned for repos |
| `RELAY_URL` | ✅ | — | `wss://…/relay` |
| `RELAY_SHARED_SECRET` | ✅ (≥32 chars) | — | relay auth token |
| `DB_PATH` | — | `./sessions.db` | SQLite session store |

The stale `.env.example` in the repo root lists monolith-era vars
(`MICROSOFT_APP_ID`, etc.) — **the worker ignores those.** Use only the four
above.

---

## One-machine-at-a-time rule

The relay server keeps a single `this.worker` socket. If a second worker
connects, it **silently overwrites** the first (last-writer-wins) and steals the
active session. So moving to another machine means **stop the worker on A, then
start it on B** — never run two at once.

---

## Setup on a new machine

### 1. Install prerequisites
- **Node.js 20+**
- **Claude Code CLI**, then authenticate it interactively **as the account the
  worker will run under**:
  ```
  claude   # complete the login flow once, so ~/.claude holds valid credentials
  ```
  Confirm a headless run works (no browser popup, no re-login prompt) before
  trusting the relay — the worker invokes Claude non-interactively.

### 2. Get the code and build
```bash
git clone <this-repo> teams-claude-bridge
cd teams-claude-bridge
npm ci
npm rebuild better-sqlite3   # ensures the native module matches this OS/arch
npm run build                # produces dist/
```
(Or copy a prebuilt `dist/` plus `node_modules`, but rebuild `better-sqlite3`
for the target platform regardless.)

### 3. Clone the repos you want reachable
Whatever lives under `REPO_ROOT` is what the Teams `/repos` card lists. Put the
target repos there:
```
<REPO_ROOT>/
  ├── my-service/
  ├── my-webapp/
  └── …
```

### 4. Create `.env` (worker vars only)
In the repo root, create a `.env` (gitignored — never commit it):
```dotenv
REPO_ROOT=/abs/path/to/repos
DB_PATH=./sessions.db
RELAY_URL=wss://ca-tcb-adapter.mangopond-4a6e3187.eastus2.azurecontainerapps.io/relay
RELAY_SHARED_SECRET=<same 32+ char secret configured on the container>
```
> The `RELAY_SHARED_SECRET` **must byte-for-byte match** the container's
> `relay-shared-secret`. A mismatch shows up as an immediate relay close with
> code **4401** in the worker log.

### 5. Start the worker
```bash
node dist/worker.js
```
Healthy startup logs:
```
[worker] dialing relay wss://…/relay
[worker] relay connected
```
A `relay closed (code 4401)` means the secret is wrong. Repeated
`relay closed (code 1006)` immediately after `connected`, with the socket
actually staying up, is usually a stale overlapping worker process — ensure only
one worker runs.

### 6. Verify end-to-end
In the Teams chat: send `/repos`. The card should now list **this machine's**
repos. Pick one → "Started session" → send a prompt → Claude's reply comes back.

---

## Platform notes

- **Windows → Linux (or arch change):** `better-sqlite3` is a native module; run
  `npm rebuild better-sqlite3` on the target with build tools present
  (`build-essential`/`python3` on Linux). Everything else is portable.
- **`REPO_ROOT` path style:** use the target OS's absolute path form
  (`C:\Users\…` on Windows, `/home/…` on Linux). The repo scanner matches the
  echoed `cwd` by exact path, so keep it consistent.
- **No container change needed** when moving machines — same `RELAY_URL`, same
  secret, different `REPO_ROOT`.

---

## Making it durable (survive terminal close / logoff / reboot)

The worker already reconnects to the relay with exponential backoff, so a
supervisor only needs to keep the **process** alive and restart it on crash/boot.

### Windows — Task Scheduler (recommended, no extra deps)
Run **as your own account** (so it inherits your Claude auth), "run whether
logged on or not," with an at-startup trigger and restart-on-failure. Because
"run whether logged on or not" stores your credentials, create the task
yourself rather than through an agent:
```
schtasks /create /tn "tcb-worker" /sc onstart /rl highest /ru <DOMAIN\user> ^
  /tr "cmd /c cd /d C:\path\to\teams-claude-bridge && node dist\worker.js >> worker.log 2>&1"
```
Then in Task Scheduler → task → **Settings**, enable "If the task fails, restart
every 1 minute, up to 3 times." Redirect stdout/stderr to a log file as shown.

> Do **not** run as `SYSTEM` unless you've verified Claude Code's
> `bypassPermissions` session works under that account — it won't see your
> `~/.claude` login and Claude calls will fail. Run as **you**.

### Windows — NSSM / WinSW (service wrapper)
Install [NSSM](https://nssm.cc/) or WinSW, point it at `node dist\worker.js` with
the working dir set to the repo root and the account set to yours. Both give
built-in crash-restart and boot-start. One extra tool to install.

### Linux — systemd user service
`~/.config/systemd/user/tcb-worker.service`:
```ini
[Unit]
Description=Teams-Claude bridge worker
After=network-online.target

[Service]
WorkingDirectory=/abs/path/to/teams-claude-bridge
ExecStart=/usr/bin/node dist/worker.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```
```bash
systemctl --user daemon-reload
systemctl --user enable --now tcb-worker
loginctl enable-linger $USER   # keeps the user service running after logout
```
Runs as you (inherits Claude auth), restarts on crash, starts at boot.

---

## The two real gotchas (any host, any durability method)

1. **Claude auth in a non-interactive session.** The worker spawns Claude Code
   in `bypassPermissions`. This depends on a valid Claude login in the running
   account's environment. Verify a headless Claude run actually works on the
   host **before** declaring the worker durable — a background session with no
   logged-on window is the real risk.
2. **Secret at rest.** `RELAY_SHARED_SECRET` lives in `.env` (gitignored). Keep
   that file readable only by the worker's account, and rotate it on both the
   container secret and the worker together if it's ever exposed.
