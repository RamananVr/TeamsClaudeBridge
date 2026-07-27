import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  MessageFactory,
  TurnContext,
} from 'botbuilder';
import type { Config } from './config.js';
import { handleActivity, type BotDeps, type IncomingActivity } from './bot.js';
import { SerialQueue } from './queue.js';

export interface AdapterBundle {
  adapter: CloudAdapter;
  handler: ActivityHandler;
}

/**
 * Extract an IncomingActivity from the Bot Framework TurnContext.
 * Sender identity comes from the `from` field: aadObjectId is the stable AAD
 * object id; upn is taken from a UPN-style field if the channel supplies one.
 */
function toIncoming(context: TurnContext): IncomingActivity {
  const from = context.activity.from;
  const aadObjectId = from?.aadObjectId;
  // Teams may surface the UPN in channel-specific properties; prefer those if present.
  const upn =
    (from?.properties?.userPrincipalName as string | undefined) ??
    (from?.properties?.upn as string | undefined) ??
    undefined;
  return {
    text: context.activity.text ?? '',
    conversationId: context.activity.conversation.id,
    sender: { upn, aadObjectId },
    value: context.activity.value,
  };
}

export function createAdapter(config: Config, deps: BotDeps): AdapterBundle {
  const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: config.appId,
    MicrosoftAppPassword: config.appPassword,
  });
  const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
    {},
    credentialsFactory,
  );

  const adapter = new CloudAdapter(botFrameworkAuthentication);

  adapter.onTurnError = async (context, error) => {
    console.error('[onTurnError]', error);
    try {
      await context.sendActivity(
        MessageFactory.text('Something went wrong handling your message. Please try again.'),
      );
    } catch (sendErr) {
      console.error('[onTurnError] failed to send error reply', sendErr);
    }
  };

  const queue = new SerialQueue();
  const handler = new ActivityHandler();

  handler.onMessage(async (context, next) => {
    const incoming = toIncoming(context);
    // Audit log: every inbound message activity (no secrets).
    console.log(
      `[audit] ${new Date().toISOString()} sender=${incoming.sender.aadObjectId ?? incoming.sender.upn ?? 'unknown'} conversation=${incoming.conversationId} text="${incoming.text.slice(0, 80)}"`,
    );

    const replies = await queue.run(incoming.conversationId, () => handleActivity(incoming, deps));
    for (const reply of replies) {
      if ('text' in reply) {
        await context.sendActivity(MessageFactory.text(reply.text));
      } else {
        await context.sendActivity({ attachments: [reply.card] });
      }
    }
    await next();
  });

  return { adapter, handler };
}
