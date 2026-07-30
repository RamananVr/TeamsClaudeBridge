import { parseCommand } from './commands.js';
import { isAuthorized } from './auth.js';
import { buildRepoCard } from './repoCard.js';
import type { Repo } from './repoScanner.js';

export interface IncomingActivity {
  text: string;
  conversationId: string;
  sender: { upn?: string; aadObjectId?: string };
  value?: any; // adaptive-card submit payload
}

/** Container-side record of which repo a thread is working in. */
export interface ActiveSession {
  cwd: string;
  name: string;
}

/**
 * The relay port the container drives. Prompts are fire-and-forget: the reply
 * arrives asynchronously and is delivered via proactive messaging, not returned
 * here. `requestScan` round-trips to the devbox worker (the source of truth for
 * repo paths). `end` tears down the worker-side session.
 */
export interface RelayPort {
  sendPrompt(conversationId: string, text: string, cwd?: string): void;
  requestScan(): Promise<Repo[]>;
  end(conversationId: string): void;
}

export interface BotDeps {
  relay: RelayPort;
  /** Per-conversation active repo, so the container can route card vs prompt. */
  sessions: Map<string, ActiveSession>;
  allowedUsers: Set<string>;
}

export type Reply = { text: string } | { card: any };

/**
 * Outcome of an inbound turn. `replies` are sent in-turn (immediate). When
 * `deferred` is true a prompt was dispatched over the relay and its Claude reply
 * will arrive later via proactive send — the adapter must send nothing further now.
 */
export interface Outcome {
  replies: Reply[];
  deferred: boolean;
}

const immediate = (replies: Reply[]): Outcome => ({ replies, deferred: false });

export async function handleActivity(a: IncomingActivity, d: BotDeps): Promise<Outcome> {
  if (!isAuthorized(a.sender, d.allowedUsers)) {
    return immediate([{ text: 'You are not authorized to use this bot.' }]);
  }

  // Adaptive-card submit (repo selection)
  if (a.value?.action === 'pickRepo') {
    const repos = await d.relay.requestScan();
    const chosen = repos.find(r => r.path === a.value.cwd);
    if (!chosen) {
      return immediate([{ text: 'That repo is not available. Send /repos to pick from the current list.' }]);
    }
    d.relay.end(a.conversationId); // force a fresh session in the chosen repo
    d.sessions.set(a.conversationId, { cwd: chosen.path, name: chosen.name });
    d.relay.sendPrompt(a.conversationId, 'Session started. What should I work on?', chosen.path);
    return { replies: [{ text: `Started session in \`${chosen.name}\`. Send your next message to continue.` }], deferred: true };
  }

  const cmd = parseCommand(a.text ?? '');
  switch (cmd.kind) {
    case 'repos':
    case 'new':
      return immediate([{ card: buildRepoCard(await d.relay.requestScan()) }]);
    case 'end':
      d.relay.end(a.conversationId);
      d.sessions.delete(a.conversationId);
      return immediate([{ text: 'Session ended.' }]);
    case 'status': {
      const s = d.sessions.get(a.conversationId);
      return immediate([{ text: s ? `Active session in \`${s.cwd}\`.` : 'No active session.' }]);
    }
    case 'prompt': {
      const active = d.sessions.get(a.conversationId);
      if (!active) return immediate([{ card: buildRepoCard(await d.relay.requestScan()) }]);
      if (cmd.text.trim() === '') return immediate([{ text: 'Your message was empty — type a message to continue.' }]);
      d.relay.sendPrompt(a.conversationId, cmd.text);
      return { replies: [], deferred: true };
    }
  }
}
