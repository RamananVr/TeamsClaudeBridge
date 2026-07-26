import { describe, it, expect } from 'vitest';
import { truncateForTeams } from './format.js';

describe('truncateForTeams', () => {
  it('returns short text unchanged', () => {
    expect(truncateForTeams('hi', 100)).toBe('hi');
  });
  it('truncates and appends a more-lines note', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = truncateForTeams(text, 5);
    expect(out).toMatch(/…\(45 more lines\)/);
    expect(out.split('\n').length).toBeLessThanOrEqual(6);
  });
});
