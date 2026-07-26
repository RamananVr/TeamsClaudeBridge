import { describe, it, expect } from 'vitest';
import { parseCommand } from './commands.js';

describe('parseCommand', () => {
  it('parses /new', () => expect(parseCommand('/new')).toEqual({ kind: 'new' }));
  it('parses /end', () => expect(parseCommand('/end')).toEqual({ kind: 'end' }));
  it('parses /status', () => expect(parseCommand('/status')).toEqual({ kind: 'status' }));
  it('parses /repos', () => expect(parseCommand('/repos')).toEqual({ kind: 'repos' }));
  it('treats other text as a prompt', () =>
    expect(parseCommand('fix the bug')).toEqual({ kind: 'prompt', text: 'fix the bug' }));
  it('trims surrounding whitespace', () =>
    expect(parseCommand('  /new  ')).toEqual({ kind: 'new' }));
});
