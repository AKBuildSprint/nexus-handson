import { resolve } from 'node:path';
import { resolveLocalBindingContext } from '../../scripts/verification/local-binding-context';
import { expect, setPersistedSessionTiming, signInConsole, test } from '../support/console-auth-fixtures';

const CONSOLE_ORIGIN = process['env'].PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173';

async function sessionCookieMetadata(page: import('@playwright/test').Page) {
  const cookies = await page.context().cookies(CONSOLE_ORIGIN);
  return cookies
    .filter((cookie) => cookie.name.endsWith('better-auth.session_token'))
    .map(({ name, expires, httpOnly, secure, sameSite }) => ({ name, expires, httpOnly, secure, sameSite }));
}

test('maps one absolute Wrangler persistence root to the proxy v3 directory', () => {
  const persistRoot = resolve('.wrangler/e2e-auth-contract');
  const context = resolveLocalBindingContext({ configPath: 'wrangler.jsonc', persistRoot });
  expect(context.cliPersistRoot).toBe(persistRoot);
  expect(context.proxyPersistPath).toBe(resolve(persistRoot, 'v3'));
  expect(() => resolveLocalBindingContext({ configPath: 'wrangler.jsonc', persistRoot: '.wrangler/relative' }))
    .toThrow(/absolute path/);
  expect(() => resolveLocalBindingContext({ configPath: 'wrangler.jsonc', persistRoot: resolve(persistRoot, 'v3') }))
    .toThrow(/without the v3 suffix/);
  expect(() => resolveLocalBindingContext({ configPath: 'wrangler.jsonc', persistRoot: resolve('/tmp/nexus-e2e') }))
    .toThrow(/under the repository \.wrangler directory/);
});

test('uses the shared local bindings for public catalog data', async ({ page, consoleAuth }) => {
  await page.goto('/console/products');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const catalog = await page.evaluate(async () => {
    const response = await fetch('/api/storefront/products');
    return await response.json() as { products?: Array<{ id: string; name: string }> };
  });
  expect(catalog.products).toContainEqual(expect.objectContaining({
    id: consoleAuth.sentinel.id,
    name: consoleAuth.sentinel.name,
  }));
});

test('discards an Owner response after Staff replaces the identity and synchronizes sibling tabs', async ({ page, consoleAuth }) => {
  await page.goto('/console/products');
  await signInConsole(page, consoleAuth.owner);
  const sibling = await page.context().newPage();
  await sibling.goto(`${CONSOLE_ORIGIN}/console/products`);
  await expect(sibling.getByText(consoleAuth.owner.name, { exact: true }).first()).toBeVisible();

  const beforeRefresh = await sessionCookieMetadata(page);
  expect(beforeRefresh).toHaveLength(1);
  expect(beforeRefresh[0]).toMatchObject({ httpOnly: true });
  await setPersistedSessionTiming(consoleAuth.owner.userId, {
    updatedAt: '2000-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const refreshedProducts = await page.evaluate(async () => (await fetch('/api/console/products')).status);
  expect(refreshedProducts).toBe(200);
  await expect(page.getByText(consoleAuth.owner.name, { exact: true }).first()).toBeVisible();
  const afterRefresh = await sessionCookieMetadata(page);
  expect(afterRefresh).toHaveLength(1);
  expect(afterRefresh[0].expires).toBeGreaterThan(beforeRefresh[0].expires);

  let releaseOwnerResponse: (() => void) | undefined;
  let markOwnerResponseReady: (() => void) | undefined;
  let markOwnerResponseReleased: (() => void) | undefined;
  const ownerResponseGate = new Promise<void>((resolveGate) => { releaseOwnerResponse = resolveGate; });
  const ownerResponseReady = new Promise<void>((resolveReady) => { markOwnerResponseReady = resolveReady; });
  const ownerResponseReleased = new Promise<void>((resolveReleased) => { markOwnerResponseReleased = resolveReleased; });
  let heldOwnerBody = '';
  const detailPattern = `**/api/console/products/by-slug/${consoleAuth.sentinel.id}`;
  await page.route(detailPattern, async (route) => {
    const response = await route.fetch();
    heldOwnerBody = await response.text();
    markOwnerResponseReady?.();
    await ownerResponseGate;
    await route.fulfill({ response, body: heldOwnerBody }).catch(() => undefined);
    markOwnerResponseReleased?.();
  });
  await page.goto(`${CONSOLE_ORIGIN}/console/products/${consoleAuth.sentinel.id}`);
  await ownerResponseReady;
  expect(heldOwnerBody).toContain(consoleAuth.sentinel.privateEvidence);

  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(async () => (await sessionCookieMetadata(page)).length).toBe(0);
  await expect(sibling.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await signInConsole(page, consoleAuth.staff);
  await expect(page.getByText(consoleAuth.staff.name, { exact: true }).first()).toBeVisible();
  await expect(sibling.getByText(consoleAuth.staff.name, { exact: true }).first()).toBeVisible();
  releaseOwnerResponse?.();
  await ownerResponseReleased;
  await page.unroute(detailPattern);
  await page.goBack();
  await expect(page.getByText(consoleAuth.staff.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(consoleAuth.owner.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(consoleAuth.sentinel.privateEvidence, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Product' })).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 812 });
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions).toMatchObject({ clientWidth: 375, scrollWidth: 375 });
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(375);

  await setPersistedSessionTiming(consoleAuth.staff.userId, {
    updatedAt: '2000-01-01T00:00:00.000Z',
    expiresAt: '2000-01-01T00:00:00.000Z',
  });
  await sibling.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(sibling.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(async () => (await sessionCookieMetadata(sibling)).length).toBe(0);
});
