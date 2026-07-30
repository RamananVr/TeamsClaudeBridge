import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  MessageFactory,
  TurnContext,
} from 'botbuilder';
import type { ContainerConfig } from './config.js';
import { handleActivity, type BotDeps, type IncomingActivity } from './bot.js';
import type { ConversationRefStore } from './conversationRefStore.js';
import { truncateForTeams } from './format.js';
import { SerialQueue } from './queue.js';

export interface AdapterBundle {
  adapter: CloudAdapter;
  handler: ActivityHandler;
  /** Deliver an async Claude reply to a conversation via proactive messaging. */
  sendProactive: (conversationId: string, text: string) => Promise<void>;
}

/**
 * Extract an IncomingActivity from the Bot Framework TurnContext.
 * Sender identity comes from the `from` field: aadObjectId is the stable AAD
 * object id; upn is taken from a UPN-style field if the channel supplies one.
 */
function toIncoming(context: TurnContext): IncomingActivity {
  const from = context.activity.from;
  const aadObjectId = from?.aadObjectId;
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

/**
 * Build the container's Bot Framework adapter. Keyless (UserAssignedMSI) auth — no
 * password: botbuilder routes MicrosoftAppType='UserAssignedMSI' to the managed
 * identity credential factory. Captures a ConversationReference per inbound turn so
 * async Claude replies can be delivered later via continueConversation.
 */
export function createAdapter(
  config: ContainerConfig,
  deps: BotDeps,
  refStore: ConversationRefStore,
): AdapterBundle {
  const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: config.appId,
    MicrosoftAppType: config.appType,
    MicrosoftAppTenantId: config.appTenantId,
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
    // Re-capture the conversation reference every turn so a restart self-heals.
    refStore.set(incoming.conversationId, TurnContext.getConversationReference(context.activity));
    console.log(
      `[audit] ${new Date().toISOString()} sender=${incoming.sender.aadObjectId ?? incoming.sender.upn ?? 'unknown'} conversation=${incoming.conversationId} text="${incoming.text.slice(0, 80)}"`,
    );

    const outcome = await queue.run(incoming.conversationId, () => handleActivity(incoming, deps));
    for (const reply of outcome.replies) {
      if ('text' in reply) {
        await context.sendActivity(MessageFactory.text(reply.text));
      } else {
        await context.sendActivity({ attachments: [reply.card] });
      }
    }
    await next();
  });

  const sendProactive = async (conversationId: string, text: string): Promise<void> => {
    const ref = refStore.get(conversationId);
    if (!ref) {
      console.error(`[sendProactive] no conversation reference for ${conversationId} — dropping reply`);
      return;
    }
    await adapter.continueConversationAsync(config.appId ?? '', ref, async (context) => {
      await context.sendActivity(MessageFactory.text(truncateForTeams(text, 60)));
    });
  };

  return { adapter, handler, sendProactive };
}
