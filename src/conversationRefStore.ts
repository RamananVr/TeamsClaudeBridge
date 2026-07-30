import type { ConversationReference } from 'botbuilder';

/**
 * Maps a Teams conversationId to the ConversationReference needed for proactive
 * sends. In the split, a prompt's Claude reply arrives asynchronously over the relay
 * long after the inbound turn ended, so the container must reopen the conversation
 * via adapter.continueConversation(ref, ...). In-memory is sufficient: refs are
 * re-captured on every inbound activity, so a container restart self-heals on the
 * user's next message.
 */
export class ConversationRefStore {
  private refs = new Map<string, Partial<ConversationReference>>();

  set(conversationId: string, ref: Partial<ConversationReference>): void {
    this.refs.set(conversationId, ref);
  }

  get(conversationId: string): Partial<ConversationReference> | undefined {
    return this.refs.get(conversationId);
  }
}
