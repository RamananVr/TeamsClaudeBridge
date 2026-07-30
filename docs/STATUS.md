# Project Status

_Last updated: 2026-07-29_

## What this is

A Microsoft Teams ↔ Claude Code CLI bridge. Messages sent in a Teams chat/thread are
relayed to a Claude Code session running on an always-on devbox against real local repos,
and Claude's replies are relayed back. **One Teams thread ↔ one Claude session**, each bound
to a chosen local repo.

**Split-hosting model (resolves the credential blocker):** a thin Bot Framework adapter runs
in an Azure Container App with a User-Assigned Managed Identity (keyless bot auth — sidesteps
the tenant's secret/cert ban). Claude Code and the real repos stay on the devbox. The devbox
has no inbound port, so its worker dials an **outbound** WebSocket relay to the container,
pulls prompts, runs Claude, and pushes results back; the container relays those to Teams via
Bot Framework proactive messaging.

Commands: `/repos`, `/new` (repo pick-list card), `/end`, `/status`.

## Status

- **Code:** Split-hosting relay implemented, reviewed, committed on `feat/split-hosting-relay`.
  Build clean, all tests pass. See relay modules under `src/relay/` and `src/worker.ts`.
- **Azure infra:** Adapter targets Container App **ca-tcb-adapter** (env cae-tcb-dev-eus2) with
  UAMI **id-tcb-adapter-eus2** (clientId `85441132-48e2-4ad1-a8a5-7633f2c8a433`). Infra
  reconfiguration + deploy is the remaining hard-to-reverse step.
- **End-to-end verification (Task 14):** Pending the deploy + Teams round-trip smoke test.

## ⚠️ Security invariants (do NOT weaken)

The bot runs Claude Code in full auto-approve mode (`bypassPermissions` +
`allowDangerouslySkipPermissions`). The `ALLOWED_USERS` allowlist is therefore the **sole**
safeguard against arbitrary command execution on the devbox.

- `config.ts` refuses to start on an empty allowlist — **never remove that guard.**
- Authorization is **deny-by-default**: no case-folding, no wildcards, no broadening.
- Repo selection is always a **pick-list card** — never free-text cwd. `bot.ts` validates the
  submitted cwd against `scanRepos()` by strict equality.
- **Never commit** `.env` or `.certs/` (private keys). `.env.example` is placeholders only.

## Azure provisioning blocker

Provisioning is paused because the target tenant blocks every practical bot credential path.

- **Subscription:** `e0b3fc49-3365-47b8-946b-ad9adea3fdbe` (name **Nova-Dev-NPE**,
  tenant `b1a4f7cb-a159-44a6-ac48-6674e85c4ddc`).
- **Policy** `1df2c21c-1b51-4a1d-9170-588f9f7c3e36`:
  - forbids client **secrets** entirely (`Credential type not allowed`), and
  - rejects **certificate** credentials at every lifetime tried down to 7 days
    (`Credential lifetime exceeds the max value allowed`).
- **Managed Identity (UAMI)** avoids the policy but only issues tokens to Azure-hosted compute.
  The bot process must run on the devbox (alongside Claude and the local repos), so MSI cannot
  authenticate there.
- **Corp policy:** new Entra app registrations require
  `--service-management-reference 494d48a3-9782-48f2-b33f-2c86c9932c68`.

All throwaway app registrations created during attempts were deleted and verified. No SP,
resource group, bot, `.env`, or `.certs/` were left behind — clean state.

## To resume infra (pick one)

1. **Different tenant** that allows normal secret/cert credentials — candidate: **TestTRS01**
   (tenant `72f988bf`, sub `169f8b11`). Keeps bot + Claude on the devbox as designed. Simplest.
2. **Policy exemption** for the app object from a tenant admin, then re-run the secret/cert path.
3. **Split hosting** — run only the thin adapter process on Azure (Container App / VM) with a
   UAMI, relaying to Claude on the devbox. Real re-architecture.

After a credential exists: create resource group `rg-teams-claude-bridge`, `az bot create`
(`--sku F0`, `--app-type MultiTenant`, placeholder endpoint), write the gitignored `.env`,
then do Task 14 end-to-end verification (sideload `teams-app/manifest.json`).

## Key files

- `src/index.ts` — entrypoint (restify server, `/api/messages`).
- `src/adapter.ts` — Bot Framework wiring (CloudAdapter, ActivityHandler, credential factory).
- `src/bot.ts` — activity handler: auth, repo pick-list, commands, prompt dispatch.
- `src/config.ts` — config loader with the mandatory allowlist guard.
- `src/sessionManager.ts` / `src/sessionStore.ts` — thread→session persistence (SQLite).
- `src/queue.ts` — per-thread serial queue.
- `teams-app/manifest.json`, `teams-app/README.md` — Teams sideload + setup guide.
- `docs/plans/` — original design doc and implementation plan.
