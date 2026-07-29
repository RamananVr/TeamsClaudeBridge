import 'dotenv/config';
import restify from 'restify';
import { loadContainerConfig } from './config.js';
import { createAdapter } from './adapter.js';
import { ConversationRefStore } from './conversationRefStore.js';
import { RelayServer } from './relay/relayServer.js';
import type { ActiveSession, BotDeps } from './bot.js';
import { makeMessagesHandler } from './httpHandler.js';
import { WebSocketServer } from 'ws';

const config = loadContainerConfig();

const refStore = new ConversationRefStore();
const sessions = new Map<string, ActiveSession>();

// Bound after the adapter is built (relay → proactive send).
let deliver: (conversationId: string, text: string) => Promise<void> = async () => {};

const relayServer = new RelayServer({
  secret: config.relaySecret,
  onResult: (conversationId, text) => {
    void deliver(conversationId, text);
  },
});

const deps: BotDeps = {
  relay: {
    sendPrompt: (c, t, cwd) => relayServer.sendPrompt(c, t, cwd),
    requestScan: () => relayServer.requestScan(),
    end: (c) => relayServer.end(c),
  },
  sessions,
  allowedUsers: config.allowedUsers,
};

const { adapter, handler, sendProactive } = createAdapter(config, deps, refStore);
deliver = sendProactive;

const server = restify.createServer();

server.post('/api/messages', makeMessagesHandler(adapter, (context) => handler.run(context)));

// Outbound relay: the devbox worker dials wss://<fqdn>/relay.
const wss = new WebSocketServer({ server: server.server, path: '/relay' });
wss.on('connection', (ws) => {
  relayServer.handleConnection({
    send: (data) => ws.send(data),
    close: (code) => ws.close(code),
    on: (event: any, cb: any) => { ws.on(event, cb); return undefined as any; },
  });
});

server.listen(config.port, () => {
  console.log(`Teams-Claude bridge (container) listening on ${server.url}`);
});
