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
