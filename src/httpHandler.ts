import type { CloudAdapter, TurnContext } from 'botbuilder';

/**
 * Build the restify POST /api/messages handler. Restify requires a
 * callback-based handler to take a third `next` arg, OR an async handler
 * taking at most two — so this MUST stay `async` (adapter.process is async
 * anyway). A non-async 2-arg handler makes restify throw ERR_ASSERTION at
 * route registration and the container crash-loops on boot.
 */
export function makeMessagesHandler(
  adapter: Pick<CloudAdapter, 'process'>,
  logic: (context: TurnContext) => Promise<void>,
) {
  return async function messagesHandler(req: unknown, res: unknown): Promise<void> {
    await adapter.process(req as never, res as never, (context) => logic(context));
  };
}
