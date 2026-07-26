import { describe, it, expect } from 'vitest';
import { ClaudeRunner } from './claudeRunner.js';

describe('ClaudeRunner', () => {
  it('starts a new session and captures session id + text', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', session_id: 'sess-abc' };
      yield { type: 'assistant', text: 'done' };
    };
    const runner = new ClaudeRunner(fakeQuery as any);
    const res = await runner.run({ prompt: 'hi', cwd: 'C:/x' });
    expect(res.sessionId).toBe('sess-abc');
    expect(res.text).toContain('done');
  });
  it('passes resume session id through options', async () => {
    let seen: any;
    const fakeQuery = async function* (opts: any) {
      seen = opts;
      yield { type: 'system', session_id: 'sess-xyz' };
      yield { type: 'assistant', text: 'ok' };
    };
    const runner = new ClaudeRunner(fakeQuery as any);
    await runner.run({ prompt: 'more', cwd: 'C:/x', resumeSessionId: 'sess-xyz' });
    expect(seen.options.resume).toBe('sess-xyz');
  });
  it('extracts text from real SDK assistant content blocks', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', session_id: 'sess-real' };
      yield { type: 'assistant', session_id: 'sess-real', message: { content: [ { type: 'text', text: 'hello' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: 'world' } ] } };
    };
    const runner = new ClaudeRunner(fakeQuery as any);
    const res = await runner.run({ prompt: 'hi', cwd: 'C:/x' });
    expect(res.sessionId).toBe('sess-real');
    expect(res.text).toContain('hello');
    expect(res.text).toContain('world');
  });
});
