import { query } from '@anthropic-ai/claude-agent-sdk';

export interface RunInput {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
}

export interface RunResult {
  sessionId: string;
  text: string;
}

type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncGenerator<any>;

function extractAssistantText(msg: any): string {
  if (typeof msg.text === 'string' && msg.text.length > 0) {
    return msg.text;
  }
  const content = msg.message?.content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  return '';
}

export class ClaudeRunner {
  constructor(private queryFn: QueryFn) {}

  async run(input: RunInput): Promise<RunResult> {
    const options: Record<string, unknown> = {
      cwd: input.cwd,
      permissionMode: 'bypassPermissions', // full auto-approve (design decision)
      allowDangerouslySkipPermissions: true, // required companion flag (sdk.d.ts:1721)
    };
    if (input.resumeSessionId) options.resume = input.resumeSessionId;

    let sessionId = input.resumeSessionId ?? '';
    const parts: string[] = [];
    for await (const msg of this.queryFn({ prompt: input.prompt, options })) {
      if (msg.session_id) sessionId = msg.session_id;
      if (msg.type === 'assistant') {
        const t = extractAssistantText(msg);
        if (t) parts.push(t);
      }
    }
    return { sessionId, text: parts.join('\n') };
  }
}

export function createClaudeRunner(): ClaudeRunner {
  return new ClaudeRunner(query as unknown as QueryFn);
}
