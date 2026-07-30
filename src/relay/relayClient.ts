import { PROTOCOL_VERSION, parseFrame, serialize, type Repo } from './protocol.js';
import { SerialQueue } from '../queue.js';

/** Minimal socket surface, so the dispatch logic is unit-testable without a real ws. */
export interface RelayClientSocket {
  send(data: string): void;
  on(event: 'open', cb: () => void): this;
  on(event: 'message', cb: (data: Buffer | string) => void): this;
  on(event: 'close', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
}

export interface RelayClientOptions {
  /** Shared secret sent as the auth token on connect. */
  secret: string;
  /** Runs a prompt for a conversation and resolves with Claude's reply text. */
  handlePrompt: (conversationId: string, text: string, cwd?: string) => Promise<string>;
  /** Re-scans REPO_ROOT; the single source of truth for valid repo paths. */
  scan: () => Repo[];
  /** Ends a conversation's session. */
  end: (conversationId: string) => void;
}

/**
 * WS client half of the split-hosting relay, running on the devbox. Dials the
 * container, authenticates, then serves prompt/scan/end requests. Per-conversation
 * ordering is preserved with a SerialQueue (mirrors the monolith's adapter).
 *
 * Security: a prompt may carry an echoed `cwd` chosen at repo-pick time, but the
 * container is untrusted for paths — the worker re-scans REPO_ROOT and requires the
 * cwd to exactly match a discovered repo path before running Claude. A forged cwd
 * is rejected with an error frame and never executed.
 */
export class RelayClient {
  private readonly opts: RelayClientOptions;
  private readonly queue = new SerialQueue();
  private sock: RelayClientSocket | undefined;

  constructor(opts: RelayClientOptions) {
    this.opts = opts;
  }

  /** Bind handlers to a socket (dialed elsewhere) and drive the protocol. */
  attach(sock: RelayClientSocket): void {
    this.sock = sock;
    sock.on('open', () => {
      sock.send(serialize({ v: PROTOCOL_VERSION, type: 'auth', token: this.opts.secret }));
    });
    sock.on('message', (data) => {
      const frame = parseFrame(data.toString());
      if (!frame) return;
      this.onServerFrame(frame);
    });
  }

  private onServerFrame(frame: NonNullable<ReturnType<typeof parseFrame>>): void {
    switch (frame.type) {
      case 'authOk':
        break;
      case 'scanReq': {
        const repos = this.opts.scan();
        this.send({ v: PROTOCOL_VERSION, type: 'scanRes', id: frame.id, repos });
        break;
      }
      case 'prompt': {
        const { id, conversationId, text, cwd } = frame;
        if (cwd !== undefined && !this.opts.scan().some(r => r.path === cwd)) {
          this.send({ v: PROTOCOL_VERSION, type: 'error', id, message: `Unknown repo path — refusing to run: ${cwd}` });
          break;
        }
        void this.queue.run(conversationId, async () => {
          try {
            const reply = await this.opts.handlePrompt(conversationId, text, cwd);
            this.send({ v: PROTOCOL_VERSION, type: 'result', id, conversationId, text: reply });
          } catch (err) {
            this.send({ v: PROTOCOL_VERSION, type: 'error', id, message: err instanceof Error ? err.message : String(err) });
          }
        });
        break;
      }
      case 'end':
        this.opts.end(frame.conversationId);
        break;
      default:
        // client→server types echoed back: ignore.
        break;
    }
  }

  private send(frame: Parameters<typeof serialize>[0]): void {
    this.sock?.send(serialize(frame));
  }
}
