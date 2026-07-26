export type Command =
  | { kind: 'new' } | { kind: 'end' } | { kind: 'status' }
  | { kind: 'repos' } | { kind: 'prompt'; text: string };

export function parseCommand(input: string): Command {
  const t = input.trim();
  switch (t) {
    case '/new': return { kind: 'new' };
    case '/end': return { kind: 'end' };
    case '/status': return { kind: 'status' };
    case '/repos': return { kind: 'repos' };
    default: return { kind: 'prompt', text: t };
  }
}
