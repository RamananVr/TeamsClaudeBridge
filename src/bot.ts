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
      if (cmd.text.trim() === '') return [{ text: 'Your message was empty — type a message to continue.' }];
      const res = await d.manager.handlePrompt(a.conversationId, cmd.text);
      return [{ text: truncateForTeams(res.text, 60) }];
    }
  }
}
