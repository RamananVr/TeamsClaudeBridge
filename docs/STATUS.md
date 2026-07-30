# Project Status

_Last updated: 2026-07-29_

## What this is

A Microsoft Teams ↔ Claude Code CLI bridge. Messages sent in a Teams chat/thread are
relayed to a Claude Code session running on an always-on devbox against real local repos,
and Claude's replies are relayed back. **One Teams thread ↔ one Claude session**, each bound
to a chosen local repo.

**Split-hosting model (resolved the credential blocker):** a thin Bot Framework adapter runs
in an Azure Container App with a User-Assigned Managed Identity (keyless bot auth — sidesteps
the tenant's secret/cert ban). Claude Code and the real repos stay on the devbox. The devbox
has no inbound port, so its worker dials an **outbound** WebSocket relay to the container,
pulls prompts, runs Claude, and pushes results back; the container relays those to Teams via
Bot Framework proactive messaging.

Commands: `/repos`, `/new` (repo pick-list card), `/end`, `/status`.

## Status

**✅ End-to-end working.** A Teams message drives a Claude Code session on the devbox and the
reply comes back in-thread. The split-hosting relay is deployed and the round-trip is verified.

- **Code:** Split-hosting relay implemented, reviewed, and committed on
  `feat/split-hosting-relay`. Build clean, all tests pass. Relay modules under `src/relay/`,
  devbox entrypoint `src/worker.ts`, container entrypoint `src/index.ts`. README and
  `WORKER-SETUP.md` reflect the current architecture.
- **Azure infra (deployed):** Adapter runs in Container App **ca-tcb-adapter**
  (env cae-tcb-dev-eus2, East US 2), bound to UAMI **id-tcb-adapter-eus2**
  (clientId `85441132-48e2-4ad1-a8a5-7633f2c8a433`). Bot **bot-tcb-dev-eus2** is registered
  against that identity (`msaAppType=UserAssignedMSI`), messaging endpoint
  `https://ca-tcb-adapter.mangopond-4a6e3187.eastus2.azurecontainerapps.io/api/messages`.
  Ingress `transport: Http`, single-revision mode, min=max=1 replica (in-memory relay/session
  state must not split-brain). Container env: `MicrosoftAppId`, `MicrosoftAppType`,
  `MicrosoftAppTenantId`, `ALLOWED_USERS`, `RELAY_SHARED_SECRET`, `PORT=3978` (stale
  wrong-tenant vars removed).
- **Devbox worker:** dials `wss://ca-tcb-adapter.…/relay`, authenticates with
  `RELAY_SHARED_SECRET`, scans `REPO_ROOT`. Runbook for durability and running on a different
  machine in [`WORKER-SETUP.md`](../WORKER-SETUP.md).
- **End-to-end verification (Task 14):** **Complete.** `/repos` → repo card → session start →
  prompt → proactive reply confirmed in Teams. No secrets present in container or worker logs.

## Open items

- **Merge to `main`:** `feat/split-hosting-relay` is ready; open a PR when desired.
- **Worker durability:** worker currently runs interactively. Wrap it in a supervisor
  (Task Scheduler / NSSM / systemd user service) to survive logoff/reboot — steps documented
  in `WORKER-SETUP.md`, not yet applied.

## ⚠️ Security invariants (do NOT weaken)

The worker runs Claude Code in full auto-approve mode (`bypassPermissions` +
`allowDangerouslySkipPermissions`), so the relay is effectively a remote-code-execution
channel into `REPO_ROOT`. Defense in depth:

- **`ALLOWED_USERS`** on the container is the sole Teams ingress guard; `config.ts` refuses to
  start on an empty allowlist — **never remove that guard.** Deny-by-default: no case-folding,
  no wildcards, no broadening.
- **`RELAY_SHARED_SECRET`** (≥32 bytes, `crypto.timingSafeEqual`, exact match) authenticates
  the worker; container and worker both refuse to start without it. Mismatch → relay close
  code **4401**.
- **Repo selection is always a pick-list card** — never free-text cwd. The **worker**
  re-scans `REPO_ROOT` and validates the echoed `cwd` by strict equality before starting a
  session; it never trusts the container's echoed path.
- Bot auth is **keyless** (UAMI) — no secret or cert to leak.
- **Never commit** `.env` or `.certs/`. `.env.example` is placeholders only. Mask secret
  values in reports (first 4 chars + length).

## History: the credential blocker (resolved)

Provisioning was originally paused because the target tenant blocks every practical bot
credential path. Split-hosting (adapter on Azure with a UAMI, worker on the devbox) resolved
it — the notes below are retained for context.

- **Subscription:** `e0b3fc49-3365-47b8-946b-ad9adea3fdbe` (**Nova-Dev-NPE**,
  tenant `b1a4f7cb-a159-44a6-ac48-6674e85c4ddc`).
- **Policy** `1df2c21c-1b51-4a1d-9170-588f9f7c3e36`: forbids client **secrets** entirely, and
  rejects **certificate** credentials at every lifetime down to 7 days.
- **Managed Identity (UAMI)** avoids the policy but only issues tokens to Azure-hosted
  compute — which is exactly why only the adapter (not the whole bot) moved to Azure.
- **Corp policy:** new Entra app registrations require
  `--service-management-reference 494d48a3-9782-48f2-b33f-2c86c9932c68`.

## Key files

- `src/index.ts` — container entrypoint (restify `/api/messages`, relay WS server).
- `src/worker.ts` — devbox entrypoint (SessionManager, ClaudeRunner, relay WS client).
- `src/relay/` — relay protocol, server, and client.
- `src/adapter.ts` — Bot Framework wiring (CloudAdapter, MSI credential factory, no password).
- `src/bot.ts` — activity handler: auth, repo pick-list, commands, prompt dispatch.
- `src/config.ts` — `loadContainerConfig` / `loadWorkerConfig` + the mandatory allowlist guard.
- `src/sessionManager.ts` / `src/sessionStore.ts` — thread→session persistence (SQLite).
- `src/queue.ts` — per-thread serial queue.
- `teams-app/manifest.json` — Teams sideload package.
- `README.md`, `WORKER-SETUP.md` — architecture + worker runbook.
- `docs/plans/` — original design doc and implementation plan.
