import 'dotenv/config';
import restify from 'restify';
import { loadConfig } from './config.js';
import { SessionStore } from './sessionStore.js';
import { createClaudeRunner } from './claudeRunner.js';
import { SessionManager } from './sessionManager.js';
import { scanRepos } from './repoScanner.js';
import { createAdapter } from './adapter.js';
import type { BotDeps } from './bot.js';

const config = loadConfig();

const store = new SessionStore(config.dbPath);
const runner = createClaudeRunner();
const manager = new SessionManager(store, runner);

const deps: BotDeps = {
  store,
  manager,
  scanRepos: () => scanRepos(config.repoRoot),
  allowedUsers: config.allowedUsers,
};

const { adapter, handler } = createAdapter(config, deps);

const server = restify.createServer();

server.post('/api/messages', (req, res) => {
  adapter.process(req as any, res as any, (context) => handler.run(context));
});

const port = process.env.PORT ?? 3978;
server.listen(port, () => {
  console.log(`Teams-Claude bridge listening on ${server.url}`);
});
