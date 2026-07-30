import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, parseFrame, serialize, type Repo } from './protocol.js';

/**
 * Minimal socket surface the server needs, so the core logic is unit-testable
 * without a real network. A `ws` WebSocket satisfies this shape.
 */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number): void;
  on(event: 'message', cb: (data: Buffer | string) => void): this;
  on(event: 'close', cb: () => void): this;
}

/** Close code for a failed/absent auth handshake. */
const AUTH_FAIL_CODE = 4401;

export interface RelayServerOptions {
  /** Shared secret; the worker's auth token must match exactly. */
  secret: string;
  /** Delivers a Claude reply (or a surfaced error) for a conversation to Teams. */
  onResult: (conversationId: string, text: string) => void;
}

interface PendingPrompt {
  conversationId: string;
}

interface PendingScan {
  resolve: (repos: Repo[]) => void;
  reject: (err: Error) => void;
}

/**
 * WS server half of the split-hosting relay. A single authenticated worker
 * (the devbox) connects; the container pushes prompts/scan requests and routes
 * results back to Teams via `onResult`. Token auth is constant-time,
 * exact-match, deny-by-default — the relay drives Claude in bypassPermissions
 * mode, so an unauthenticated peer must never reach it.
 */
export class RelayServer {
  private readonly secretBuf: Buffer;
  private readonly onResult: (conversationId: string, text: string) => void;
  private worker: RelaySocket | undefined;
  private readonly pendingPrompts = new Map<string, PendingPrompt>();
  private readonly pendingScans = new Map<string, PendingScan>();

  constructor(opts: RelayServerOptions) {
    this.secretBuf = Buffer.from(opts.secret);
    this.onResult = opts.onResult;
  }

  /** Wire up a freshly accepted socket; it must authenticate as its first frame. */
  handleConnection(sock: RelaySocket): void {
    let authed = false;
    sock.on('message', (data) => {
      const frame = parseFrame(data.toString());
      if (!authed) {
        if (!frame || frame.type !== 'auth' || !this.checkToken(frame.token)) {
          sock.close(AUTH_FAIL_CODE);
          return;
        }
        authed = true;
        this.worker = sock;
        sock.send(serialize({ v: PROTOCOL_VERSION, type: 'authOk' }));
        return;
      }
      if (!frame) return;
      this.onWorkerFrame(frame);
    });
    sock.on('close', () => {
      if (this.worker === sock) {
        this.worker = undefined;
        this.failPending('Worker disconnected — the devbox dropped the connection. Try again shortly.');
      }
    });
  }

  /** Push a prompt to the worker; the reply arrives later via `onResult`. */
  sendPrompt(conversationId: string, text: string, cwd?: string): void {
    if (!this.worker) {
      this.onResult(conversationId, 'Worker offline — the devbox is not connected. Try again shortly.');
      return;
    }
    const id = randomUUID();
    this.pendingPrompts.set(id, { conversationId });
    this.worker.send(serialize({ v: PROTOCOL_VERSION, type: 'prompt', id, conversationId, text, cwd }));
  }

  /** Ask the worker to re-scan REPO_ROOT and return the repo list. */
  requestScan(): Promise<Repo[]> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker offline — the devbox is not connected.'));
    }
    const id = randomUUID();
    const worker = this.worker;
    return new Promise<Repo[]>((resolve, reject) => {
      this.pendingScans.set(id, { resolve, reject });
      worker.send(serialize({ v: PROTOCOL_VERSION, type: 'scanReq', id }));
    });
  }

  /** Tell the worker to end a conversation's Claude session. */
  end(conversationId: string): void {
    this.worker?.send(serialize({ v: PROTOCOL_VERSION, type: 'end', conversationId }));
  }

  private onWorkerFrame(frame: ReturnType<typeof parseFrame>): void {
    if (!frame) return;
    switch (frame.type) {
      case 'result': {
        if (this.pendingPrompts.delete(frame.id)) {
          this.onResult(frame.conversationId, frame.text);
        }
        break;
      }
      case 'error': {
        const pending = this.pendingPrompts.get(frame.id);
        if (pending) {
          this.pendingPrompts.delete(frame.id);
          this.onResult(pending.conversationId, `Error: ${frame.message}`);
        }
        break;
      }
      case 'scanRes': {
        const pending = this.pendingScans.get(frame.id);
        if (pending) {
          this.pendingScans.delete(frame.id);
          pending.resolve(frame.repos);
        }
        break;
      }
      default:
        // auth after handshake or any server→client type: ignore.
        break;
    }
  }

  /**
   * Drain both pending maps when the worker drops, so no adapter turn hangs on
   * an unresolved scan and no prompt silently vanishes. Prompts surface an
   * offline notice to Teams; scans reject their awaiting caller.
   */
  private failPending(message: string): void {
    for (const [, pending] of this.pendingPrompts) {
      this.onResult(pending.conversationId, message);
    }
    this.pendingPrompts.clear();
    for (const [, pending] of this.pendingScans) {
      pending.reject(new Error(message));
    }
    this.pendingScans.clear();
  }

  private checkToken(token: string): boolean {
    const tokenBuf = Buffer.from(token);
    if (tokenBuf.length !== this.secretBuf.length) return false;
    return timingSafeEqual(tokenBuf, this.secretBuf);
  }
}
