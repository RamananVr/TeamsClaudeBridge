# Teams ↔ Claude Code Bridge

## Overview

This bridge relays Microsoft Teams messages to [Claude Code](https://claude.com/claude-code)
sessions running on your devbox against your real local git repositories. Each Teams
thread maps to exactly one Claude Code session, so you can start a coding task from
Teams, watch Claude make changes on disk, and keep the conversation going by replying
in the same thread. The bot connects **outbound** through Azure Bot Service, so your
devbox does not need a permanent public inbound port for normal operation.

## Prerequisites

- **Node.js** (18+ recommended) and npm on the devbox.
- Access to Azure subscription **TestTRS01**
  (``, tenant ``).
- Permission to create an **Entra App Registration** and an **Azure Bot** resource.
- **Teams sideloading (custom app upload)** enabled for your account.
  > ⚠️ In a corporate tenant this is frequently disabled and may require **tenant
  > admin approval**. This is a known possible blocker — confirm it early.
- Claude Code auth on the devbox (an `ANTHROPIC_API_KEY`, or existing Claude Code
  credentials).

## Configuration

All configuration comes from environment variables, loaded via `loadConfig()`.

| Variable                  | Meaning |
|---------------------------|---------|
| `REPO_ROOT`               | Base directory scanned for git repos (e.g. `C:\Users\rarame\Repos`). |
| `MICROSOFT_APP_ID`        | Azure Bot / Entra app (client) ID used for bot auth. |
| `MICROSOFT_APP_PASSWORD`  | Azure Bot client secret. |
| `ANTHROPIC_API_KEY`       | Claude API key (or rely on existing devbox Claude Code auth). |
| `DB_PATH`                 | SQLite session store path (default `./sessions.db`). |
| `ALLOWED_USERS`           | **MANDATORY** comma-separated allowlist of Teams AAD object IDs / UPNs. |

Example `.env` (never commit this file):

```dotenv
REPO_ROOT=C:\Users\x\Repos
MICROSOFT_APP_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_APP_PASSWORD=your-bot-secret
ANTHROPIC_API_KEY=sk-ant-...
DB_PATH=./sessions.db
ALLOWED_USERS=11111111-2222-3333-4444-555555555555
```

> 🔒 **`ALLOWED_USERS` is mandatory.** It is the **only** thing preventing arbitrary
> command execution on your devbox, because Claude runs in full auto-approve mode.
> The bridge **refuses to start** if `ALLOWED_USERS` is empty. List every Teams
> AAD object ID / UPN that is allowed to drive the bridge — and no one else.

## Setup (Azure Bot + Teams)

These are manual steps you perform in the Azure Portal and Teams.

1. **Create the Azure Bot + Entra App Registration.**
   In subscription `e0b3fc49-3365-47b8-946b-ad9adea3fdbe`, create an **Azure Bot**
   resource with a **multi-tenant** (or single-tenant, per your policy) Entra App
   Registration. Capture the app (client) ID as `MICROSOFT_APP_ID` and generate a
   client secret as `MICROSOFT_APP_PASSWORD`. Put both in your `.env`.

2. **Enable the Microsoft Teams channel.**
   On the Azure Bot resource, open **Channels** and enable **Microsoft Teams**.

3. **Set the messaging endpoint.**
   Set the bot's messaging endpoint to your bridge's `POST /api/messages`. For local
   testing, run a tunnel (Azure **dev tunnels** or **ngrok**) to
   `http://localhost:3978/api/messages` and use the tunnel's public HTTPS URL as the
   endpoint. The outbound Azure Bot model means the devbox needs no permanent public
   inbound port for normal operation, but the messaging endpoint must be reachable
   during the Bot Framework handshake — a dev tunnel covers this.

4. **Prepare the Teams app package.**
   In `teams-app/manifest.json`, replace `{{MICROSOFT_APP_ID}}` (appears as both `id`
   and `bot.botId`) with your real `MICROSOFT_APP_ID`. Add `color.png` (192x192) and
   `outline.png` (32x32, transparent) to `teams-app/` (see `teams-app/ICONS.md`), then
   zip the three files at the archive root.

5. **Sideload the zip into Teams.**
   In Teams: **Apps -> Manage your apps -> Upload an app -> Upload a custom app** and
   pick your zip.
   > ⚠️ May require **tenant admin approval** — possible blocker.

6. **Run the bridge on the devbox.**
   ```bash
   npm install
   # create and populate .env (see Configuration above)
   npm run build
   npm start
   ```
   The bridge starts a restify server on `POST /api/messages` (port 3978 default).

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

- Claude runs in **full auto-approve mode** — it can make disk changes and run
  commands without prompting.
- The **`ALLOWED_USERS` allowlist is the primary and sole safeguard**. Only listed
  Teams identities may drive the bridge; the bridge refuses to start with an empty
  allowlist.
- **Secrets live only in `.env`** and must never be committed (`.env` is gitignored).
- Every inbound message is written to an **audit log**.

## Verification

Fill in as you validate each scenario (Task 14):

- [ ] New thread → repo pick-list card → session acknowledgement.
- [ ] Coding prompt makes a change on disk **and** replies in the same thread.
- [ ] Reply in the thread resumes the **same** session.
- [ ] `/status` reports the correct repo/session.
- [ ] `/end` then a new prompt shows the pick-list again.
- [ ] An unauthorized user is refused.
- [ ] Restart the bridge → `/status` still resolves the session via SQLite.
- [ ] Long output is truncated with a `…(N more lines)` marker.
