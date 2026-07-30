import type { Repo } from '../repoScanner.js';

export type { Repo } from '../repoScanner.js';

export const PROTOCOL_VERSION = 1;

// Client (devbox worker) → server (container)
export interface AuthFrame { v: 1; type: 'auth'; token: string; }
export interface ResultFrame { v: 1; type: 'result'; id: string; conversationId: string; text: string; }
export interface ErrorFrame { v: 1; type: 'error'; id: string; message: string; }
export interface ScanResFrame { v: 1; type: 'scanRes'; id: string; repos: Repo[]; }

// Server (container) → client (devbox worker)
export interface AuthOkFrame { v: 1; type: 'authOk'; }
export interface PromptFrame { v: 1; type: 'prompt'; id: string; conversationId: string; text: string; cwd?: string; }
export interface ScanReqFrame { v: 1; type: 'scanReq'; id: string; }
export interface EndFrame { v: 1; type: 'end'; conversationId: string; }

export type Frame =
  | AuthFrame | ResultFrame | ErrorFrame | ScanResFrame
  | AuthOkFrame | PromptFrame | ScanReqFrame | EndFrame;

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function isRepoArray(x: unknown): x is Repo[] {
  return Array.isArray(x) && x.every(r => r && typeof r === 'object' && isStr((r as any).name) && isStr((r as any).path));
}

/**
 * Parse and validate a relay wire frame. Returns the typed frame, or `undefined`
 * for anything malformed, wrong-version, or unknown-type. Deny-by-default: an
 * unrecognized shape is dropped, never coerced.
 */
export function parseFrame(raw: string): Frame | undefined {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!obj || typeof obj !== 'object' || obj.v !== PROTOCOL_VERSION || !isStr(obj.type)) {
    return undefined;
  }
  switch (obj.type as Frame['type']) {
    case 'auth':
      return isStr(obj.token) ? { v: 1, type: 'auth', token: obj.token } : undefined;
    case 'authOk':
      return { v: 1, type: 'authOk' };
    case 'prompt':
      if (!isStr(obj.id) || !isStr(obj.conversationId) || !isStr(obj.text)) return undefined;
      if (obj.cwd !== undefined && !isStr(obj.cwd)) return undefined;
      return { v: 1, type: 'prompt', id: obj.id, conversationId: obj.conversationId, text: obj.text, ...(obj.cwd !== undefined ? { cwd: obj.cwd } : {}) };
    case 'result':
      return isStr(obj.id) && isStr(obj.conversationId) && isStr(obj.text)
        ? { v: 1, type: 'result', id: obj.id, conversationId: obj.conversationId, text: obj.text }
        : undefined;
    case 'error':
      return isStr(obj.id) && isStr(obj.message)
        ? { v: 1, type: 'error', id: obj.id, message: obj.message }
        : undefined;
    case 'scanReq':
      return isStr(obj.id) ? { v: 1, type: 'scanReq', id: obj.id } : undefined;
    case 'scanRes':
      return isStr(obj.id) && isRepoArray(obj.repos)
        ? { v: 1, type: 'scanRes', id: obj.id, repos: obj.repos }
        : undefined;
    case 'end':
      return isStr(obj.conversationId) ? { v: 1, type: 'end', conversationId: obj.conversationId } : undefined;
    default:
      return undefined;
  }
}

export function serialize(frame: Frame): string {
  return JSON.stringify(frame);
}
