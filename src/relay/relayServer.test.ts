import { describe, it, expect, vi } from 'vitest';
import { RelayServer, type RelaySocket } from './relayServer.js';
import { PROTOCOL_VERSION, serialize, type Frame } from './protocol.js';

const SECRET = 's'.repeat(32);

class FakeSocket implements RelaySocket {
  sent: string[] = [];
  closedCode?: number;
  private handlers: Record<string, ((...a: any[]) => void)[]> = {};
  send(data: string) { this.sent.push(data); }
  close(code?: number) { this.closedCode = code; this.emit('close'); }
  on(event: 'message' | 'close', cb: (...a: any[]) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  emit(event: string, ...args: any[]) { (this.handlers[event] ?? []).forEach(h => h(...args)); }
  receive(frame: Frame) { this.emit('message', Buffer.from(serialize(frame))); }
  lastFrame(): any { return JSON.parse(this.sent[this.sent.length - 1]); }
  frames(): any[] { return this.sent.map(s => JSON.parse(s)); }
}

function authed() {
  const onResult = vi.fn();
  const server = new RelayServer({ secret: SECRET, onResult });
  const sock = new FakeSocket();
  server.handleConnection(sock);
  sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: SECRET });
  return { server, sock, onResult };
}

describe('RelayServer auth', () => {
  it('closes 4401 on a wrong token', () => {
    const server = new RelayServer({ secret: SECRET, onResult: vi.fn() });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: 'wrong-token-'.padEnd(32, 'x') });
    expect(sock.closedCode).toBe(4401);
  });
  it('closes 4401 on an empty token', () => {
    const server = new RelayServer({ secret: SECRET, onResult: vi.fn() });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: '' } as any);
    expect(sock.closedCode).toBe(4401);
  });
  it('closes 4401 when the first frame is not auth', () => {
    const server = new RelayServer({ secret: SECRET, onResult: vi.fn() });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'scanRes', id: 'x', repos: [] });
    expect(sock.closedCode).toBe(4401);
  });
  it('sends authOk on the correct token', () => {
    const { sock } = authed();
    expect(sock.lastFrame().type).toBe('authOk');
    expect(sock.closedCode).toBeUndefined();
  });
});

describe('RelayServer prompt round-trip', () => {
  it('emits a prompt then delivers the matching result', () => {
    const onResult = vi.fn();
    const server = new RelayServer({ secret: SECRET, onResult });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: SECRET });
    sock.sent = [];

    server.sendPrompt('c1', 'do a thing', 'C:/r/a');
    const promptFrame = sock.lastFrame();
    expect(promptFrame.type).toBe('prompt');
    expect(promptFrame.conversationId).toBe('c1');
    expect(promptFrame.text).toBe('do a thing');
    expect(promptFrame.cwd).toBe('C:/r/a');

    sock.receive({ v: PROTOCOL_VERSION, type: 'result', id: promptFrame.id, conversationId: 'c1', text: 'all done' });
    expect(onResult).toHaveBeenCalledWith('c1', 'all done');
  });

  it('routes an error frame to onResult with a message', () => {
    const onResult = vi.fn();
    const server = new RelayServer({ secret: SECRET, onResult });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: SECRET });
    server.sendPrompt('c1', 'x');
    const id = sock.lastFrame().id;
    sock.receive({ v: PROTOCOL_VERSION, type: 'error', id, message: 'boom' });
    expect(onResult).toHaveBeenCalledWith('c1', expect.stringMatching(/boom/));
  });

  it('reports worker-offline via onResult when no worker is connected', () => {
    const onResult = vi.fn();
    const server = new RelayServer({ secret: SECRET, onResult });
    server.sendPrompt('c1', 'x');
    expect(onResult).toHaveBeenCalledWith('c1', expect.stringMatching(/offline|not connected/i));
  });
});

describe('RelayServer scan round-trip', () => {
  it('resolves requestScan with the returned repos', async () => {
    const onResult = vi.fn();
    const server = new RelayServer({ secret: SECRET, onResult });
    const sock = new FakeSocket();
    server.handleConnection(sock);
    sock.receive({ v: PROTOCOL_VERSION, type: 'auth', token: SECRET });
    sock.sent = [];

    const p = server.requestScan();
    const reqFrame = sock.lastFrame();
    expect(reqFrame.type).toBe('scanReq');
    const repos = [{ name: 'a', path: 'C:/r/a' }];
    sock.receive({ v: PROTOCOL_VERSION, type: 'scanRes', id: reqFrame.id, repos });
    await expect(p).resolves.toEqual(repos);
  });

  it('rejects requestScan when no worker is connected', async () => {
    const server = new RelayServer({ secret: SECRET, onResult: vi.fn() });
    await expect(server.requestScan()).rejects.toThrow(/offline|not connected/i);
  });

  it('rejects an in-flight requestScan when the worker disconnects', async () => {
    const { server, sock } = authed();
    const p = server.requestScan();
    sock.emit('close');
    await expect(p).rejects.toThrow(/offline|disconnect|not connected/i);
  });
});

describe('RelayServer disconnect cleanup', () => {
  it('reports a worker-offline result for an in-flight prompt when the worker disconnects', () => {
    const { server, sock, onResult } = authed();
    server.sendPrompt('c1', 'x');
    onResult.mockClear();
    sock.emit('close');
    expect(onResult).toHaveBeenCalledWith('c1', expect.stringMatching(/offline|disconnect|not connected/i));
  });
});
