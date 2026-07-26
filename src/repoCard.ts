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
