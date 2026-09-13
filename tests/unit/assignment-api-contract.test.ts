import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignConsoleOrder } from '../../apps/console/src/api-client';

afterEach(() => vi.unstubAllGlobals());

describe('assignment API result contract', () => {
  it('accepts the exact action-discriminated assignment result', async () => {
    const body = {
      reference: 'NX-ABCDEF0123456789',
      action: 'assign',
      status: 'pending',
      occurredAt: '2026-09-12T00:00:00.000Z',
      paymentId: null,
      refundRequest: null,
      assignment: { assigneeUserId: 'staff_user', eventId: 'hist_assignment' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(assignConsoleOrder('NX-ABCDEF0123456789', 'staff_user', 'assignment-key-0001'))
      .resolves.toEqual(body);
  });

  it('rejects an assign result without its immutable event binding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      reference: 'NX-ABCDEF0123456789', action: 'assign', status: 'pending',
      occurredAt: '2026-09-12T00:00:00.000Z', paymentId: null, refundRequest: null,
      assignment: { assigneeUserId: 'staff_user' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(assignConsoleOrder('NX-ABCDEF0123456789', 'staff_user', 'assignment-key-0001'))
      .rejects.toThrow('The assignment response is invalid.');
  });
});
