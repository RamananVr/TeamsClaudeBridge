import { describe, it, expect } from 'vitest';
import { ConversationRefStore } from './conversationRefStore.js';

describe('ConversationRefStore', () => {
  it('returns undefined for an unknown conversation', () => {
    const s = new ConversationRefStore();
    expect(s.get('nope')).toBeUndefined();
  });
  it('stores and retrieves a reference by conversation id', () => {
    const s = new ConversationRefStore();
    const ref = { conversation: { id: 'c1' } } as any;
    s.set('c1', ref);
    expect(s.get('c1')).toBe(ref);
  });
  it('overwrites an existing reference on re-set', () => {
    const s = new ConversationRefStore();
    s.set('c1', { conversation: { id: 'c1' }, a: 1 } as any);
    s.set('c1', { conversation: { id: 'c1' }, a: 2 } as any);
    expect((s.get('c1') as any).a).toBe(2);
  });
});
