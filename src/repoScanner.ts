import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Repo { name: string; path: string; }

export function scanRepos(root: string): Repo[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root)
    .map(name => ({ name, path: join(root, name) }))
    .filter(r => {
      try { return statSync(r.path).isDirectory() && existsSync(join(r.path, '.git')); }
      catch { return false; }
    });
}
