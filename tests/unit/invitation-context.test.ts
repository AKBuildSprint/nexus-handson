import { describe, expect, it } from 'vitest';
import {
  digestInvitationToken,
  invitationContextHmac,
  parseUntrustedInvitationContext,
  parseUntrustedInvitationToken,
} from '@nexus/identity/invitations';

const SECRET = 'nexus-test-only-secret-32-bytes-minimum';
const RAW_TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

describe('Owner invitation context', () => {
  it('parses raw tokens and HMAC contexts as distinct credentials', async () => {
    expect(parseUntrustedInvitationToken(RAW_TOKEN)).toEqual({ kind: 'present', token: RAW_TOKEN });
    expect(parseUntrustedInvitationContext(RAW_TOKEN)).toEqual({ kind: 'invalid' });

    const context = await invitationContextHmac(SECRET, RAW_TOKEN);
    const digest = await digestInvitationToken(RAW_TOKEN);
    expect(context).toMatch(/^[0-9a-f]{64}$/);
    expect(context).not.toBe(digest);
    expect(context).not.toBe(RAW_TOKEN);
    expect(parseUntrustedInvitationContext(context)).toEqual({ kind: 'present', context });
    expect(parseUntrustedInvitationToken(context)).toEqual({ kind: 'present', token: context });
    expect(await invitationContextHmac(SECRET, context)).not.toBe(context);
  });

  it('rejects blank, oversized, and non-hex context values', () => {
    expect(parseUntrustedInvitationContext(undefined)).toEqual({ kind: 'absent' });
    expect(parseUntrustedInvitationContext('')).toEqual({ kind: 'absent' });
    expect(parseUntrustedInvitationContext('g'.repeat(64))).toEqual({ kind: 'invalid' });
    expect(parseUntrustedInvitationContext('a'.repeat(65))).toEqual({ kind: 'invalid' });
  });
});
