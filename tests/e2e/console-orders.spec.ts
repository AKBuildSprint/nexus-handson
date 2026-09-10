import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';

const CONSOLE_ORIGIN = process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173';
const STOREFRONT_ORIGIN = process.env.PLAYWRIGHT_STOREFRONT_BASE_URL ?? 'http://127.0.0.1:5174';

interface OrderItemResponse {
  product: {
    name: string;
    variant: null | {
      sku: string;
      selectedOptions: Array<{ groupName: string; valueLabel: string }>;
    };
  };
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

interface OrderResponse {
  reference: string;
  paymentReference: string;
  status: 'pending' | 'paid' | 'fulfilled' | 'canceled';
  items: OrderItemResponse[];
  totalMinor: number;
  currency: string;
  createdAt: string;
}

interface ConsoleOrderResponse extends OrderResponse {
  customer: { name: string; email: string };
  refundRequestStatus: 'pending' | null;
}


function uniqueToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fillRequiredProduct(page: Page, name: string, basePrice: string) {
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Base price').fill(basePrice);
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Product status').selectOption('Active');
  await page.getByLabel('Customer-visible description').fill(`Public description for ${name}`);
  await page.getByLabel('Private access title').fill(`Private package for ${name}`);
  await page.getByLabel('Private access instructions').fill('Use the private delivery package after payment.');
}

async function saveProduct(page: Page) {
  await page.locator('button.desktop-save').click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
}

async function createSimpleProduct(page: Page, name: string, basePrice = '21.25') {
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, name, basePrice);
  await saveProduct(page);
}

async function createVariantProduct(page: Page, name: string, token: string) {
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, name, '32.00');
  await page.getByRole('button', { name: 'Add option group' }).click();
  const group = page.locator('section.option-group').last();
  await group.getByRole('textbox', { name: /Option group \d+/ }).fill('Format');
  await group.getByRole('textbox', { name: 'Value 1' }).fill('PDF');
  await group.getByRole('button', { name: 'Add value' }).click();
  await group.getByRole('textbox', { name: 'Value 2' }).fill('ZIP');
  await page.getByRole('button', { name: 'Generate matrix' }).click();
  const rows = page.locator('.variant-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('PDF');
  await rows.nth(0).locator('input[id^="sku-"]').fill(`E2E-${token}-PDF`);
  await rows.nth(0).locator('input[id^="price-"]').fill('41.75');
  await rows.nth(1).locator('input[id^="sku-"]').fill(`E2E-${token}-ZIP`);
  await saveProduct(page);
}

async function placeOrder(page: Page, productName: string, variantLabel?: string): Promise<{ body: OrderResponse; capability: string }> {
  const row = page.locator('.catalog-row').filter({ hasText: productName });
  await expect(row).toBeVisible();
  await row.locator('button.catalog-choice').click();
  if (variantLabel) await page.getByLabel('Format').selectOption({ label: variantLabel });
  await page.locator('#checkout-quantity').fill('1');
  await page.getByRole('button', { name: 'Add to Order' }).click();
  await page.getByLabel('Name').fill('Console Journey Customer');
  await page.getByLabel('Email').fill('console.journey@example.test');

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.origin === CONSOLE_ORIGIN && url.pathname === '/api/storefront/orders';
  });
  await page.getByRole('button', { name: 'Place Order' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = await response.json() as OrderResponse;
  expect(body.reference).toMatch(/^NX-[A-F0-9]{16}$/);
  expect(body.status).toBe('pending');
  await expect(page.getByText(`Order ${body.reference}`)).toBeVisible();

  const orderUrl = new URL(page.url());
  const capability = new URLSearchParams(orderUrl.hash.slice(1)).get('capability') ?? '';
  expect(orderUrl.search === '').toBe(true);
  expect(capability.length).toBeGreaterThanOrEqual(32);
  return { body, capability };
}

function containsPrivateProjectionKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateProjectionKey);
  if (value === null || typeof value !== 'object') return false;
  const forbidden = new Set([
    'capability',
    'privateurl',
    'privatefilekey',
    'deliveryfilekey',
    'deliveryaccessinstructions',
    'accessinstructions',
  ]);
  return Object.entries(value).some(([key, child]) => forbidden.has(key.toLowerCase()) || containsPrivateProjectionKey(child));
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(dimensions.client).toBe(width);
  expect(dimensions.documentScroll).toBeLessThanOrEqual(dimensions.client);
  expect(dimensions.bodyScroll).toBeLessThanOrEqual(dimensions.client);
}

async function tabUntilFocused(page: Page, locator: Locator, limit = 40) {
  for (let index = 0; index < limit; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
}

test('keeps Console search, filters, pager, and confirmation reachable by keyboard without overflow', async ({ page }, testInfo) => {
  const name = `Verify Console Keys ${uniqueToken()}`;
  await createSimpleProduct(page, name, '9.50');
  await page.goto(STOREFRONT_ORIGIN);
  const order = await placeOrder(page, name);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  if (await skip.evaluate((element) => element === document.activeElement).catch(() => false)) {
    await page.keyboard.press('Enter');
  }
  await tabUntilFocused(page, page.getByLabel('Search Orders'));
  await tabUntilFocused(page, page.getByRole('tab', { name: 'All' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Pending' })).toBeFocused();
  await tabUntilFocused(page, page.getByLabel('Pending refund requests'));
  const orderPages = page.getByRole('navigation', { name: 'Order pages top', exact: true });
  await expect(orderPages).toBeVisible();
  const nextPage = orderPages.getByRole('button', { name: 'Next', exact: true });
  if (await nextPage.isEnabled()) {
    await tabUntilFocused(page, nextPage);
  }
  await page.getByLabel('Search Orders').fill(order.body.reference);
  await page.getByRole('button', { name: 'Search' }).focus();
  await expect(page.getByRole('button', { name: 'Search' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: order.body.reference })).toBeVisible();
  const desktopOverflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      overflowing: [...document.querySelectorAll('body *')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.right > viewport + 1;
        })
        .slice(0, 5)
        .map((element) => element.className.toString()),
    };
  });
  expect(desktopOverflow.viewport).toBe(1280);
  expect(desktopOverflow.overflowing).toEqual([]);

  await redactVisibleEmails(page);
  await page.locator('.page-stack').screenshot({ path: testInfo.outputPath('ui-01-console-list-1280.png') });

  await page.getByRole('link', { name: order.body.reference }).click();
  await expect(page.getByRole('heading', { name: order.body.reference })).toBeVisible();
  await tabUntilFocused(page, page.getByRole('button', { name: 'Record manual payment' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Record manual payment' })).toBeVisible();
  await tabUntilFocused(page, page.getByLabel('I confirm an external receipt exists for this exact total and currency.'));
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeEnabled();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 375);
  await redactVisibleEmails(page);
  await page.locator('.page-stack').screenshot({ path: testInfo.outputPath('ui-01-console-list-375.png') });
});

test('ignores late Order A GET and Complete after opening Order B', async ({ page }) => {
  test.setTimeout(120_000);
  const token = uniqueToken();
  const nameA = `Verify Console A ${token}`;
  const nameB = `Verify Console B ${token}`;
  await createSimpleProduct(page, nameA, '11.00');
  await createSimpleProduct(page, nameB, '12.00');
  await page.goto(STOREFRONT_ORIGIN);
  const orderA = await placeOrder(page, nameA);
  await page.getByRole('button', { name: 'Back to catalog' }).click();
  const orderB = await placeOrder(page, nameB);

  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await page.getByLabel('Search Orders').fill(orderA.body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: orderA.body.reference })).toBeVisible();

  let releaseGet: (() => void) | undefined;
  const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
  await page.route(`**/api/console/orders/${orderA.body.reference}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await getGate;
    try {
      await route.continue();
    } catch {
      // Navigation may abort the in-flight GET.
    }
  });
  const getA = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.pathname === `/api/console/orders/${orderA.body.reference}`;
  });
  const getAFailed = page.waitForEvent('requestfailed', (request) => {
    try {
      const url = new URL(request.url());
      return request.method() === 'GET' && url.pathname === `/api/console/orders/${orderA.body.reference}`;
    } catch {
      return false;
    }
  });
  await page.getByRole('link', { name: orderA.body.reference }).click();
  await getA;
  await page.getByRole('button', { name: 'Back to Orders' }).click();
  await page.getByLabel('Search Orders').fill(orderB.body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: orderB.body.reference })).toBeVisible();
  await page.getByRole('link', { name: orderB.body.reference }).click();
  await expect(page.getByRole('heading', { name: orderB.body.reference })).toBeVisible();
  const getAResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === `/api/console/orders/${orderA.body.reference}`;
  });
  releaseGet?.();
  await Promise.race([getAResponse, getAFailed]);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(page.getByRole('heading', { name: orderB.body.reference })).toBeVisible();
  await expect(page.getByRole('heading', { name: orderA.body.reference })).toHaveCount(0);
  await page.unroute(`**/api/console/orders/${orderA.body.reference}`);

  await page.getByRole('button', { name: 'Back to Orders' }).click();
  await page.getByLabel('Search Orders').fill(orderA.body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: orderA.body.reference })).toBeVisible();
  await page.getByRole('link', { name: orderA.body.reference }).click();
  await expect(page.getByRole('heading', { name: orderA.body.reference })).toBeVisible();

  let releasePost: (() => void) | undefined;
  const postGate = new Promise<void>((resolve) => { releasePost = resolve; });
  let postCommitted = false;
  let postDelivered: (() => void) | undefined;
  const postDelivery = new Promise<void>((resolve) => { postDelivered = resolve; });
  await page.route(`**/api/console/orders/${orderA.body.reference}/payments/manual`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    postCommitted = true;
    await postGate;
    await route.fulfill({ response: committed });
    postDelivered?.();
  });
  await page.getByRole('button', { name: 'Record manual payment' }).click();
  await page.getByLabel('Payment method').fill('Bank transfer');
  await page.getByLabel('External payment reference').fill(`WIRE-${orderA.body.reference.slice(-8)}`);
  await page.getByRole('checkbox', { name: /I confirm/ }).check();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect.poll(() => postCommitted).toBe(true);
  await page.getByRole('button', { name: 'Back to Orders' }).click();
  await page.getByLabel('Search Orders').fill(orderB.body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: orderB.body.reference })).toBeVisible();
  await page.getByRole('link', { name: orderB.body.reference }).click();
  await expect(page.getByRole('heading', { name: orderB.body.reference })).toBeVisible();
  releasePost?.();
  await postDelivery;
  await expect(page.getByRole('heading', { name: orderB.body.reference })).toBeVisible();
  await expect(page.getByText('Pending').first()).toBeVisible();
  await expect(page.getByText('The outcome is not confirmed. Retry the same action.')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: orderA.body.reference })).toHaveCount(0);
});

function queryLocalOrderGraph(reference: string): {
  status: string;
  history_count: number;
  paid_events: number;
  command_count: number;
  refund_count: number;
} {
  expect(reference).toMatch(/^NX-[A-F0-9]{16}$/);
  const sql = `SELECT o.status AS status,
    (SELECT count(*) FROM order_history h WHERE h.order_id = o.id AND h.store_id = o.store_id) AS history_count,
    (SELECT count(*) FROM order_history h WHERE h.order_id = o.id AND h.action = 'order_paid') AS paid_events,
    (SELECT count(*) FROM order_commands c WHERE c.order_id = o.id) AS command_count,
    (SELECT count(*) FROM order_refund_requests r WHERE r.order_id = o.id) AS refund_count
    FROM orders o WHERE o.reference = '${reference}'`;
  const output = execFileSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'nexus-s1-468cba-db',
    '--local', '--config', 'wrangler.jsonc', '--json', '--command', sql,
  ], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results: Array<Record<string, unknown>> }>;
  const row = parsed[0]?.results[0];
  expect(row).toBeTruthy();
  return {
    status: String(row.status),
    history_count: Number(row.history_count),
    paid_events: Number(row.paid_events),
    command_count: Number(row.command_count),
    refund_count: Number(row.refund_count),
  };
}

async function redactVisibleEmails(page: Page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('body *')) {
      if (!node.childElementCount && /@/.test(node.textContent ?? '')) {
        node.textContent = '[redacted-email]';
      }
    }
  });
}

test('shows separate Simple and Variant Orders safely through direct, navigation, and 375px Console journeys', async ({ page }) => {
  const token = uniqueToken();
  const simpleName = `Verify Console Simple ${token}`;
  const variantName = `Verify Console Variant ${token}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await createSimpleProduct(page, simpleName);
  await createVariantProduct(page, variantName, token);

  const observedRequestUrls: string[] = [];
  page.on('request', (request) => observedRequestUrls.push(request.url()));
  await page.goto(STOREFRONT_ORIGIN);
  const simpleOrder = await placeOrder(page, simpleName);
  expect(simpleOrder.body.items[0].product.variant === null).toBe(true);
  expect(simpleOrder.body.items[0].unitPriceMinor).toBe(2125);
  expect(simpleOrder.body.totalMinor).toBe(2125);

  await page.getByRole('button', { name: 'Back to catalog' }).click();
  await expect(page.locator('.catalog-row').filter({ hasText: variantName })).toBeVisible();
  const variantOrder = await placeOrder(page, variantName, 'PDF');
  expect(variantOrder.body.items[0].product.variant !== null).toBe(true);
  expect(variantOrder.body.items[0].product.variant?.selectedOptions.some((option) => option.groupName === 'Format' && option.valueLabel === 'PDF')).toBe(true);
  expect(variantOrder.body.items[0].unitPriceMinor).toBe(4175);
  expect(variantOrder.body.totalMinor).toBe(4175);

  const capabilities = [simpleOrder.capability, variantOrder.capability];
  expect(observedRequestUrls.some((url) => capabilities.some((secret) => url.includes(secret) || url.includes(encodeURIComponent(secret))))).toBe(false);

  const ordersResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.origin === CONSOLE_ORIGIN && url.pathname === '/api/console/orders';
  });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  const ordersResponse = await ordersResponsePromise;
  expect(ordersResponse.ok()).toBe(true);
  const projection = await ordersResponse.json() as { orders: ConsoleOrderResponse[] };
  const journeyOrderCount = projection.orders.filter((order) => order.items.some((item) => item.product.name === simpleName || item.product.name === variantName)).length;
  expect(journeyOrderCount).toBe(2);
  expect(containsPrivateProjectionKey(projection)).toBe(false);
  expect(capabilities.some((secret) => JSON.stringify(projection).includes(secret))).toBe(false);
  expect(JSON.stringify(projection).includes('Use the private delivery package after payment.')).toBe(false);

  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Storefront Orders' });
  await expect(table).toBeVisible();
  const simpleRow = table.locator('tbody tr').filter({ hasText: simpleOrder.body.reference });
  const variantRow = table.locator('tbody tr').filter({ hasText: variantOrder.body.reference });
  await expect(simpleRow).toContainText(simpleName);
  await expect(simpleRow).toContainText('Simple Product');
  await expect(variantRow).toContainText(variantName);
  await expect(variantRow).toContainText('Format: PDF');
  await expect(variantRow).toContainText('Pending');

  const bodyLeaksPrivateData = await page.locator('body').evaluate((element, secrets) => {
    const text = element.textContent ?? '';
    return secrets.some((secret) => text.includes(secret));
  }, [...capabilities, 'Use the private delivery package after payment.']);
  expect(bodyLeaksPrivateData).toBe(false);

  await page.locator('.console-nav').getByRole('button', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await page.locator('.console-nav').getByRole('button', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(table).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(table).toBeHidden();
  const cards = page.locator('.order-summary-card');
  const simpleCard = cards.filter({ hasText: simpleOrder.body.reference });
  const variantCard = cards.filter({ hasText: variantOrder.body.reference });
  await expect(simpleCard).toBeVisible();
  await expect(simpleCard).toContainText(simpleName);
  await expect(simpleCard).toContainText('Simple Product');
  await expect(variantCard).toBeVisible();
  await expect(variantCard).toContainText(variantName);
  await expect(variantCard).toContainText('Format: PDF');
  await expect(variantCard).toContainText('Pending');
  await expectNoHorizontalOverflow(page, 375);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Compact Console navigation' }).getByRole('button', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Compact Console navigation' }).getByRole('button', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(variantCard).toBeVisible();
  await expectNoHorizontalOverflow(page, 375);
});

async function completeOrderFromDetail(page: Page, reference: string) {
  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${reference}`);
  await expect(page.getByRole('heading', { name: reference })).toBeVisible();
  await page.getByRole('button', { name: 'Record manual payment' }).click();
  await page.getByLabel('Payment method').fill('Bank transfer');
  await page.getByLabel('External payment reference').fill(`WIRE-${reference.slice(-8)}`);
  await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm/ }).check();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.locator('.status-tag.status-active')).toContainText('Paid');
}

test('completes zero-total and paid Orders, restores detail via reload and popstate, and conflicts a stale cancel', async ({ page, context }) => {
  test.setTimeout(120_000);
  const token = uniqueToken();
  const paidName = `Verify Console Paid ${token}`;
  const zeroName = `Verify Console Zero ${token}`;
  const staleName = `Verify Console Stale ${token}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await createSimpleProduct(page, paidName, '21.25');
  await createSimpleProduct(page, zeroName, '0.00');
  await createSimpleProduct(page, staleName, '12.00');

  await page.goto(STOREFRONT_ORIGIN);
  const paidOrder = await placeOrder(page, paidName);
  expect(paidOrder.body.totalMinor).toBe(2125);
  await page.getByRole('button', { name: 'Back to catalog' }).click();
  const zeroOrder = await placeOrder(page, zeroName);
  expect(zeroOrder.body.totalMinor).toBe(0);
  await page.getByRole('button', { name: 'Back to catalog' }).click();
  const staleOrder = await placeOrder(page, staleName);

  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${paidOrder.body.reference}`);
  await expect(page.getByRole('heading', { name: paidOrder.body.reference })).toBeVisible();
  await expect(page.locator('.console-nav [aria-current="page"]')).toContainText('Orders');
  await page.reload();
  await expect(page.getByRole('heading', { name: paidOrder.body.reference })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Orders' }).first().click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: paidOrder.body.reference })).toBeVisible();

  await completeOrderFromDetail(page, paidOrder.body.reference);
  await completeOrderFromDetail(page, zeroOrder.body.reference);

  const pageB = await context.newPage();
  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${staleOrder.body.reference}`);
  await expect(page.getByRole('heading', { name: staleOrder.body.reference })).toBeVisible();
  await pageB.goto(`${CONSOLE_ORIGIN}/console/orders/${staleOrder.body.reference}`);
  await completeOrderFromDetail(pageB, staleOrder.body.reference);
  await pageB.close();
  await expect(page.locator('.status-tag.status-active')).toContainText('Paid');
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm Cancel' })).toHaveCount(0);

  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await page.getByRole('tab', { name: 'Pending' }).click();
  await expect(page.getByRole('link', { name: paidOrder.body.reference })).toHaveCount(0);
  await expect(page.getByRole('link', { name: staleOrder.body.reference })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Paid' }).click();
  await expect(page.getByRole('link', { name: paidOrder.body.reference })).toBeVisible();
  await expect(page.getByRole('link', { name: zeroOrder.body.reference })).toBeVisible();
});

test('retries Mark Paid after a committed response loss using the same key', async ({ page }) => {
  const name = `Verify Console Loss ${uniqueToken()}`;
  await createSimpleProduct(page, name, '18.00');
  await page.goto(STOREFRONT_ORIGIN);
  const order = await placeOrder(page, name);

  const keys: string[] = [];
  await page.route('**/api/console/orders/*/payments/manual', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    if (keys.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ response: committed });
  });

  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${order.body.reference}`);
  await expect(page.getByRole('heading', { name: order.body.reference })).toBeVisible();
  await page.getByRole('button', { name: 'Record manual payment' }).click();
  await page.getByLabel('Payment method').fill('Bank transfer');
  await page.getByLabel('External payment reference').fill(`WIRE-${order.body.reference.slice(-8)}`);
  await page.getByRole('checkbox', { name: /I confirm/ }).check();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByText('The outcome is not confirmed. Retry the same action.')).toBeVisible();

  const afterCommit = queryLocalOrderGraph(order.body.reference);
  expect(afterCommit).toMatchObject({
    status: 'paid',
    paid_events: 1,
    command_count: 1,
    refund_count: 0,
  });

  await page.getByRole('button', { name: 'Retry Mark Paid' }).click();
  await expect(page.locator('.status-tag.status-active')).toContainText('Paid');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(queryLocalOrderGraph(order.body.reference)).toEqual(afterCommit);

  const detail = await page.request.get(`${CONSOLE_ORIGIN}/api/console/orders/${order.body.reference}`, {
    headers: { Accept: 'application/json', 'X-Nexus-Order-Contract': '2' },
  });
  expect(detail.ok()).toBe(true);
  const body = await detail.json() as { order: { history: Array<{ action: string }>; refundRequest: null } };
  expect(body.order.history.filter((event) => event.action === 'order_paid')).toHaveLength(1);
  expect(body.order.refundRequest).toBeNull();
  expect(containsPrivateProjectionKey(body)).toBe(false);
});


