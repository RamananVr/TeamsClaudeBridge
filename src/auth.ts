export interface Sender { upn?: string; aadObjectId?: string; }

export function isAuthorized(sender: Sender, allowed: Set<string>): boolean {
  if (sender.upn && allowed.has(sender.upn)) return true;
  if (sender.aadObjectId && allowed.has(sender.aadObjectId)) return true;
  return false;
}
