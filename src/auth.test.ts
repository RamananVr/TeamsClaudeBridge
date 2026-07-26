import { describe, it, expect } from 'vitest';
import { isAuthorized } from './auth.js';

describe('isAuthorized', () => {
  const allowed = new Set(['a@m.com', 'aad-id-123']);
  it('allows by UPN', () => expect(isAuthorized({ upn: 'a@m.com' }, allowed)).toBe(true));
  it('allows by AAD id', () => expect(isAuthorized({ aadObjectId: 'aad-id-123' }, allowed)).toBe(true));
  it('denies unknown', () => expect(isAuthorized({ upn: 'x@m.com' }, allowed)).toBe(false));
  it('denies when no identifiers', () => expect(isAuthorized({}, allowed)).toBe(false));
  it('denies empty-string identifiers', () => expect(isAuthorized({ upn: '', aadObjectId: '' }, allowed)).toBe(false));
  it('denies unknown AAD id', () => expect(isAuthorized({ aadObjectId: 'nope' }, allowed)).toBe(false));
});
