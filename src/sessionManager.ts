import type { SessionStore } from './sessionStore.js';
import type { ClaudeRunner, RunResult } from './claudeRunner.js';

export class SessionManager {
  constructor(private store: SessionStore, private runner: ClaudeRunner) {}

  async handlePrompt(threadId: string, text: string, cwd?: string): Promise<RunResult> {
    const existing = this.store.getActive(threadId);
    if (!existing && !cwd) {
      throw new Error('No active session for this thread — pick a repo first.');
    }
    const res = await this.runner.run({
      prompt: text,
      cwd: existing?.cwd ?? cwd!,
      resumeSessionId: existing?.claudeSessionId,
    });
    this.store.upsert(threadId, res.sessionId, existing?.cwd ?? cwd!);
    return res;
  }

  end(threadId: string): void { this.store.end(threadId); }
  status(threadId: string) { return this.store.getActive(threadId); }
}
