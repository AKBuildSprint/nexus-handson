import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { consoleRequest, resetCatalog, workerRequest } from '../support/catalog-test-env';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

beforeEach(resetCatalog);

async function insertProviderEvent(input: {
  id: string;
  providerEventId: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO provider_events (id, type, provider, provider_event_id, payload_json, store_id, order_id, received_at)
     VALUES (?, 'payment', 'payfs', ?, ?, NULL, NULL, ?)`,
  ).bind(input.id, input.providerEventId, JSON.stringify(input.payload), input.receivedAt).run();
}

function providerLogRequest(path: string): Promise<Response> {
  return consoleRequest(path, { headers: { 'X-Nexus-Order-Contract': '2' } });
}

describe('Console third-party logs route', () => {
  it('returns the owner-only immutable provider feed in deterministic pages', async () => {
    const newerPayload = { transaction_id: 'transaction-newer', amount: 14_000, account_id: 'recipient' };
    const olderPayload = { transaction_id: 'transaction-older', amount: 12_000, account_id: 'recipient' };
    await insertProviderEvent({
      id: 'provider_event_newer',
      providerEventId: 'transaction-newer',
      payload: newerPayload,
      receivedAt: '2026-09-15T10:00:01.000Z',
    });
    await insertProviderEvent({
      id: 'provider_event_older',
      providerEventId: 'transaction-older',
      payload: olderPayload,
      receivedAt: '2026-09-15T10:00:00.000Z',
    });

    const first = await providerLogRequest('/api/console/provider-events?limit=1');
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      events: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasEvents: boolean;
    };
    expect(firstBody).toEqual({
      events: [{
        id: 'provider_event_newer',
        type: 'payment',
        provider: 'payfs',
        providerEventId: 'transaction-newer',
        payloadJson: JSON.stringify(newerPayload),
        receivedAt: '2026-09-15T10:00:01.000Z',
        order: null,
      }],
      nextCursor: expect.any(String),
      hasEvents: true,
    });
    const second = await providerLogRequest(`/api/console/provider-events?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      events: [{
        id: 'provider_event_older',
        type: 'payment',
        provider: 'payfs',
        providerEventId: 'transaction-older',
        payloadJson: JSON.stringify(olderPayload),
        receivedAt: '2026-09-15T10:00:00.000Z',
        order: null,
      }],
      nextCursor: null,
      hasEvents: true,
    });
  });

  it('rejects malformed queries and denies direct Staff access without exposing payloads', async () => {
    const payload = { transaction_id: 'staff-denied', account_id: 'recipient' };
    await insertProviderEvent({
      id: 'provider_event_staff_denied',
      providerEventId: 'staff-denied',
      payload,
      receivedAt: '2026-09-15T10:00:00.000Z',
    });
    const malformed = await providerLogRequest('/api/console/provider-events?limit=1&limit=1');
    expect(malformed.status).toBe(400);

    const staff = await createConsoleSession({ email: 'provider-log-staff@example.test', role: 'staff' });
    const response = await workerRequest('/api/console/provider-events', {
      headers: {
        Cookie: staff.cookie,
        Origin: TEST_CONSOLE_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'X-Nexus-Order-Contract': '2',
      },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(JSON.stringify(payload));
  });
});
