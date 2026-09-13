import { type Page } from '@playwright/test';
import { expect, provisionLocalAuthFixture, test } from '../support/console-auth-fixtures';

const consoleOrigin = process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL!;
const storefrontOrigin = process.env.PLAYWRIGHT_STOREFRONT_BASE_URL!;
const commandHeaders = () => ({ Origin: consoleOrigin, 'X-Nexus-Order-Contract': '2', 'Idempotency-Key': crypto.randomUUID() });

async function createOrder(page: Page) {
  const created = await page.request.post(`${consoleOrigin}/api/console/products`, {
    headers: commandHeaders(),
    data: { product: { name: `Reload ${crypto.randomUUID()}`, status: 'active', currency: 'USD', basePrice: '1.00', publicDescription: 'Reload scenario', delivery: { accessTitle: 'Package', accessInstructions: 'Use the package after payment.' } }, schema: null, previewHash: null },
  });
  expect(created.status()).toBe(201);
  const { product } = await created.json() as { product: { id: string } };
  const productId = product.id;
  const capability = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const response = await page.request.post(`${consoleOrigin}/api/storefront/orders`, {
    headers: { ...commandHeaders(), Origin: storefrontOrigin, 'X-Nexus-Order-Capability': capability },
    data: { customer: { name: 'Reload Customer', email: 'reload@example.test' }, items: [{ productId, variantId: null, quantity: 1 }] },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object' || !('reference' in body) || typeof body.reference !== 'string') throw new Error('Missing created Order reference');
  return { reference: body.reference, capability };
}

for (const action of ['assignment', 'approval'] as const) {
  test(`restores the original ${action} intent after connection loss and full reload`, async ({ consoleOwnerPage: page, consoleAuth }) => {
    const { reference, capability } = await createOrder(page);
    if (action === 'approval') {
      const payment = await page.request.post(`${consoleOrigin}/api/console/orders/${reference}/payments/manual`, { headers: commandHeaders(), data: { method: 'Bank transfer', reference: crypto.randomUUID() } });
      expect(payment.status()).toBe(200);
      const refund = await page.request.post(`${consoleOrigin}/api/storefront/orders/${reference}/refund-requests`, { headers: { ...commandHeaders(), Origin: storefrontOrigin, 'X-Nexus-Order-Capability': capability }, data: { reason: 'Duplicate purchase' } });
      expect(refund.status()).toBe(200);
    }
    const keys: string[] = [];
    const pattern = action === 'assignment' ? `**/api/console/orders/${reference}/assignment` : `**/api/console/orders/${reference}/refund-requests/*/approve`;
    await page.route(pattern, async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) {
        if (action === 'approval') expect((await route.fetch()).status()).toBe(200);
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await page.goto(`${consoleOrigin}/console/orders/${reference}`);
    if (action === 'assignment') await page.getByRole('combobox', { name: 'Assign Order' }).selectOption(consoleAuth.staff.userId);
    await page.getByRole('button', { name: action === 'assignment' ? 'Assign' : 'Approve refund', exact: true }).click();
    const retry = page.getByRole('button', { name: action === 'assignment' ? 'Retry assignment' : 'Retry approve refund', exact: true });
    await expect(retry).toBeVisible();
    await page.reload();
    await expect(retry).toBeVisible({ timeout: 4000 });
    expect(keys).toHaveLength(1);
    const response = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/api/console/orders/${reference}/`));
    await retry.click();
    expect((await response).status()).toBe(200);
    await expect(retry).toHaveCount(0);
    expect(keys).toEqual([keys[0], keys[0]]);
    await page.reload();
    if (action === 'assignment') await expect(page.getByRole('combobox', { name: 'Assign Order' })).toHaveValue(consoleAuth.staff.userId);
    else {
      await expect(page.getByRole('heading', { name: reference, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Approve refund', exact: true })).toHaveCount(0);
      const detail = await page.request.get(`${consoleOrigin}/api/console/orders/${reference}`, { headers: { 'X-Nexus-Order-Contract': '2' } });
      expect(await detail.json()).toMatchObject({ order: { refundRequest: { status: 'approved' } } });
    }
  });
}

test('discards an unresolved Owner intent when Staff replaces the identity', async ({ consoleOwnerPage: page, consoleAuth }) => {
  const freshAuth = await provisionLocalAuthFixture();
  const { reference } = await createOrder(page);
  const keys: string[] = [];
  await page.route(`**/api/console/orders/${reference}/assignment`, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) await route.abort('connectionreset');
    else await route.continue();
  });
  await page.goto(`${consoleOrigin}/console/orders/${reference}`);
  await page.getByRole('combobox', { name: 'Assign Order' }).selectOption(freshAuth.staff.userId);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry assignment' })).toBeVisible();
  await page.context().addCookies([{ ...freshAuth.staff.sessionCookie, url: consoleOrigin, httpOnly: true, sameSite: 'Lax' }]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry assignment' })).toHaveCount(0);
  expect(keys).toHaveLength(1);
  await page.context().addCookies([{ ...consoleAuth.operator.sessionCookie, url: consoleOrigin, httpOnly: true, sameSite: 'Lax' }]);
  await page.reload();
  await page.getByRole('combobox', { name: 'Assign Order' }).selectOption(freshAuth.staff.userId);
  await expect(page.getByRole('button', { name: 'Retry assignment' })).toHaveCount(0);
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/assignment'));
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  expect((await response).status()).toBe(200);
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
});

test('does not dispatch a role command when browser recovery storage is unavailable', async ({ consoleOwnerPage: page, consoleAuth }) => {
  const { reference } = await createOrder(page);
  let submitted = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/assignment')) submitted += 1; });
  await page.goto(`${consoleOrigin}/console/orders/${reference}`);
  await page.getByRole('combobox', { name: 'Assign Order' }).selectOption(consoleAuth.staff.userId);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); }; });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
  expect(submitted).toBe(0);
  await page.reload();
  await page.getByRole('combobox', { name: 'Assign Order' }).selectOption(consoleAuth.staff.userId);
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/assignment'));
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  expect((await response).status()).toBe(200);
  expect(submitted).toBe(1);
});

test('keeps failed sign-in private after a network failure and reload', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/sign-in/social', async route => { attempts += 1; await route.abort('connectionreset'); });
  await page.goto(`${consoleOrigin}/console/orders`);
  await page.getByRole('button', { name: /Google/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toHaveCount(0);
  expect(attempts).toBe(1);
});
