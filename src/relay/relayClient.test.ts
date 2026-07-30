import { describe, it, expect, vi } from 'vitest';
import { RelayClient } from './relayClient.js';
import { PROTOCOL_VERSION, serialize, type Frame } from './protocol.js';

const SECRET = 's'.repeat(32);

class FakeSocket {
  sent: string[] = [];
  private handlers: Record<string, ((...a: any[]) => void)[]> = {};
  send(data: string) { this.sent.push(data); }
  on(event: string, cb: (...a: any[]) => void) { (this.handlers[event] ??= []).push(cb); return this; }
  emit(event: string, ...args: any[]) { (this.handlers[event] ?? []).forEach(h => h(...args)); }
  receive(frame: Frame) { this.emit('message', Buffer.from(serialize(frame))); }
  lastFrame(): any { return JSON.parse(this.sent[this.sent.length - 1]); }
  frames(): any[] { return this.sent.map(s => JSON.parse(s)); }
}

function makeClient(overrides: Partial<{
  handlePrompt: (id: string, text: string, cwd?: string) => Promise<string>;
  scan: () => { name: string; path: string }[];
  end: (id: string) => void;
}> = {}) {
  const handlePrompt = overrides.handlePrompt ?? vi.fn(async () => 'reply text');
  const scan = overrides.scan ?? (() => [{ name: 'a', path: 'C:/r/a' }]);
  const end = overrides.end ?? vi.fn();
  const client = new RelayClient({
    secret: SECRET,
    handlePrompt,
    scan,
    end,
  });
  const sock = new FakeSocket();
  client.attach(sock as any);
  return { client, sock, handlePrompt, scan, end };
}

describe('RelayClient auth', () => {
  it('sends an auth frame with the secret on open', () => {
    const { sock } = makeClient();
    sock.emit('open');
    const f = sock.lastFrame();
    expect(f.type).toBe('auth');
    expect(f.token).toBe(SECRET);
  });
});

describe('RelayClient scan', () => {
  it('answers scanReq with the current repo scan', async () => {
    const scan = () => [{ name: 'x', path: 'C:/r/x' }];
    const { sock } = makeClient({ scan });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.sent = [];
    sock.receive({ v: PROTOCOL_VERSION, type: 'scanReq', id: 'req1' });
    await Promise.resolve();
    const f = sock.lastFrame();
    expect(f.type).toBe('scanRes');
    expect(f.id).toBe('req1');
    expect(f.repos).toEqual([{ name: 'x', path: 'C:/r/x' }]);
  });
});

describe('RelayClient prompt', () => {
  it('runs a prompt and replies with a result frame echoing the id', async () => {
    const handlePrompt = vi.fn(async () => 'done');
    const { sock } = makeClient({ handlePrompt });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.sent = [];
    sock.receive({ v: PROTOCOL_VERSION, type: 'prompt', id: 'p1', conversationId: 'c1', text: 'hi' });
    await new Promise(r => setTimeout(r, 0));
    expect(handlePrompt).toHaveBeenCalledWith('c1', 'hi', undefined);
    const f = sock.lastFrame();
    expect(f.type).toBe('result');
    expect(f.id).toBe('p1');
    expect(f.conversationId).toBe('c1');
    expect(f.text).toBe('done');
  });

  it('re-validates an echoed cwd against a fresh scan (accepts a known path)', async () => {
    const handlePrompt = vi.fn(async () => 'ok');
    const scan = () => [{ name: 'a', path: 'C:/r/a' }];
    const { sock } = makeClient({ handlePrompt, scan });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.sent = [];
    sock.receive({ v: PROTOCOL_VERSION, type: 'prompt', id: 'p2', conversationId: 'c1', text: 'hi', cwd: 'C:/r/a' });
    await new Promise(r => setTimeout(r, 0));
    expect(handlePrompt).toHaveBeenCalledWith('c1', 'hi', 'C:/r/a');
    expect(sock.lastFrame().type).toBe('result');
  });

  it('rejects a forged cwd not present in the scan and never runs the prompt', async () => {
    const handlePrompt = vi.fn(async () => 'ok');
    const scan = () => [{ name: 'a', path: 'C:/r/a' }];
    const { sock } = makeClient({ handlePrompt, scan });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.sent = [];
    sock.receive({ v: PROTOCOL_VERSION, type: 'prompt', id: 'p3', conversationId: 'c1', text: 'hi', cwd: 'C:/evil' });
    await new Promise(r => setTimeout(r, 0));
    expect(handlePrompt).not.toHaveBeenCalled();
    const f = sock.lastFrame();
    expect(f.type).toBe('error');
    expect(f.id).toBe('p3');
    expect(f.message).toMatch(/repo|path|unknown/i);
  });

  it('surfaces a handlePrompt failure as an error frame', async () => {
    const handlePrompt = vi.fn(async () => { throw new Error('claude blew up'); });
    const { sock } = makeClient({ handlePrompt });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.sent = [];
    sock.receive({ v: PROTOCOL_VERSION, type: 'prompt', id: 'p4', conversationId: 'c1', text: 'hi' });
    await new Promise(r => setTimeout(r, 0));
    const f = sock.lastFrame();
    expect(f.type).toBe('error');
    expect(f.id).toBe('p4');
    expect(f.message).toMatch(/claude blew up/);
  });
});

describe('RelayClient end', () => {
  it('routes an end frame to the end handler', () => {
    const end = vi.fn();
    const { sock } = makeClient({ end });
    sock.emit('open');
    sock.receive({ v: PROTOCOL_VERSION, type: 'authOk' });
    sock.receive({ v: PROTOCOL_VERSION, type: 'end', conversationId: 'c1' });
    expect(end).toHaveBeenCalledWith('c1');
  });
});
