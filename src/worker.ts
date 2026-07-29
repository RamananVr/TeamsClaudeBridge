import 'dotenv/config';
import WebSocket from 'ws';
import { loadWorkerConfig } from './config.js';
import { SessionStore } from './sessionStore.js';
import { createClaudeRunner } from './claudeRunner.js';
import { SessionManager } from './sessionManager.js';
import { scanRepos } from './repoScanner.js';
import { RelayClient } from './relay/relayClient.js';

const config = loadWorkerConfig();

const store = new SessionStore(config.dbPath);
const runner = createClaudeRunner();
const manager = new SessionManager(store, runner);

const client = new RelayClient({
  secret: config.relaySecret,
  handlePrompt: async (conversationId, text, cwd) => {
    const res = await manager.handlePrompt(conversationId, text, cwd);
    return res.text;
  },
  scan: () => scanRepos(config.repoRoot),
  end: (conversationId) => manager.end(conversationId),
});

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
let backoff = RECONNECT_MIN_MS;

function connect(): void {
  console.log(`[worker] dialing relay ${config.relayUrl}`);
  const ws = new WebSocket(config.relayUrl);
  client.attach(ws as any);

  ws.on('open', () => {
    backoff = RECONNECT_MIN_MS;
    console.log('[worker] relay connected');
  });
  ws.on('close', (code: number) => {
    console.error(`[worker] relay closed (code ${code}); reconnecting in ${backoff}ms`);
    scheduleReconnect();
  });
  ws.on('error', (err: Error) => {
    console.error('[worker] relay error', err.message);
  });
}

function scheduleReconnect(): void {
  const delay = backoff;
  backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  setTimeout(connect, delay);
}

connect();
