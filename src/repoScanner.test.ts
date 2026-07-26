import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepos } from './repoScanner.js';

describe('scanRepos', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'repos-'));
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true });
    mkdirSync(join(root, 'beta', '.git'), { recursive: true });
    mkdirSync(join(root, 'not-a-repo'), { recursive: true });
  });
  it('returns only dirs containing .git', () => {
    const repos = scanRepos(root).map(r => r.name).sort();
    expect(repos).toEqual(['alpha', 'beta']);
  });
  it('returns [] for a nonexistent root', () => {
    expect(scanRepos(join(root, 'nope'))).toEqual([]);
  });
});
