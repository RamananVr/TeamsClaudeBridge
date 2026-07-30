import { describe, it, expect } from 'vitest';
import { parseFrame, PROTOCOL_VERSION } from './protocol.js';

describe('parseFrame', () => {
  it('rejects non-JSON', () => {
    expect(parseFrame('not json')).toBeUndefined();
  });
  it('rejects a wrong protocol version', () => {
    expect(parseFrame(JSON.stringify({ v: 99, type: 'auth', token: 't' }))).toBeUndefined();
  });
  it('rejects an unknown type', () => {
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'nope' }))).toBeUndefined();
  });
  it('parses an auth frame', () => {
    const f = parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'auth', token: 'secret' }));
    expect(f).toEqual({ v: PROTOCOL_VERSION, type: 'auth', token: 'secret' });
  });
  it('rejects an auth frame with a non-string token', () => {
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'auth', token: 123 }))).toBeUndefined();
  });
  it('parses a prompt frame with optional cwd', () => {
    const f = parseFrame(JSON.stringify({
      v: PROTOCOL_VERSION, type: 'prompt', id: 'r1', conversationId: 'c1', text: 'hi', cwd: 'C:/r/a',
    }));
    expect(f).toEqual({ v: PROTOCOL_VERSION, type: 'prompt', id: 'r1', conversationId: 'c1', text: 'hi', cwd: 'C:/r/a' });
  });
  it('rejects a prompt frame missing required fields', () => {
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'prompt', id: 'r1' }))).toBeUndefined();
  });
  it('parses a result frame', () => {
    const f = parseFrame(JSON.stringify({
      v: PROTOCOL_VERSION, type: 'result', id: 'r1', conversationId: 'c1', text: 'done',
    }));
    expect(f?.type).toBe('result');
  });
  it('parses an error frame', () => {
    const f = parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', id: 'r1', message: 'boom' }));
    expect(f?.type).toBe('error');
  });
  it('parses scanReq and scanRes frames', () => {
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'scanReq', id: 's1' }))?.type).toBe('scanReq');
    const res = parseFrame(JSON.stringify({
      v: PROTOCOL_VERSION, type: 'scanRes', id: 's1', repos: [{ name: 'a', path: 'C:/r/a' }],
    }));
    expect(res?.type).toBe('scanRes');
  });
  it('rejects a scanRes frame whose repos entries are malformed', () => {
    expect(parseFrame(JSON.stringify({
      v: PROTOCOL_VERSION, type: 'scanRes', id: 's1', repos: [{ name: 'a' }],
    }))).toBeUndefined();
  });
  it('parses authOk and end frames', () => {
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'authOk' }))?.type).toBe('authOk');
    expect(parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'end', conversationId: 'c1' }))?.type).toBe('end');
  });
});
