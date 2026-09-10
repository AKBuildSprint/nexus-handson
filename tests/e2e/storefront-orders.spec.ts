import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const CONSOLE_ORIGIN = process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173';
const STOREFRONT_ORIGIN = process.env.PLAYWRIGHT_STOREFRONT_BASE_URL ?? 'http://127.0.0.1:5174';

interface CustomerOrderResponse {
  reference: string;
  paymentReference: string;
  status: 'pending' | 'paid' | 'fulfilled' | 'canceled';
  items: Array<{
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
  }>;
  totalMinor: number;
  currency: string;
  createdAt: string;
  paymentNextStep: string | null;
}

function uniqueToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function visibleSave(page: Page) {
  return page.locator('button.desktop-save');
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

async function createSimpleProduct(page: Page, name: string): Promise<string> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, name, '19.95');
  await visibleSave(page).click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  return new URL(page.url()).pathname;
}


async function completeOrder(page: Page, reference: string) {
  const response = await page.request.post(`${CONSOLE_ORIGIN}/api/console/orders/${encodeURIComponent(reference)}/payments/manual`, {
    headers: {
      Origin: CONSOLE_ORIGIN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      'X-Nexus-Order-Contract': '2',
    },
    data: { method: 'Bank transfer', reference: `WIRE-${reference.slice(-8)}` },
  });
  expect(response.status()).toBe(200);
}

async function cancelOrder(page: Page, reference: string) {
  const response = await page.request.post(`${CONSOLE_ORIGIN}/api/console/orders/${encodeURIComponent(reference)}/cancel`, {
    headers: {
      Origin: CONSOLE_ORIGIN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      'X-Nexus-Order-Contract': '2',
    },
    data: {},
  });
  expect(response.status()).toBe(200);
}
async function addVariantGroup(page: Page) {
  await page.getByRole('button', { name: 'Add option group' }).click();
  const group = page.locator('section.option-group').last();
  await group.getByRole('textbox', { name: /Option group \d+/ }).fill('Format');
  await group.getByRole('textbox', { name: 'Value 1' }).fill('PDF');
  await group.getByRole('button', { name: 'Add value' }).click();
  await group.getByRole('textbox', { name: 'Value 2' }).fill('ZIP');
}

async function createVariantProduct(page: Page, name: string, token: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, name, '30.00');
  await addVariantGroup(page);
  await page.getByRole('button', { name: 'Generate matrix' }).click();
  const rows = page.locator('.variant-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('PDF');
  await rows.nth(0).locator('input[id^="sku-"]').fill(`E2E-${token}-PDF`);
  await rows.nth(0).locator('input[id^="price-"]').fill('39.50');
  await rows.nth(1).locator('input[id^="sku-"]').fill(`E2E-${token}-ZIP`);
  await visibleSave(page).click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
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

interface OrderItemLine {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
}

function orderItemLines(body: CustomerOrderResponse): OrderItemLine[] {
  return body.items.map((item) => ({
    name: item.product.name,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
    currency: body.currency,
  }));
}

function expectedMoney(minor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(minor / (10 ** fractionDigits));
}

async function expectUsableOrderItemSnapshots(page: Page, items: OrderItemLine[]) {
  const expected = items.map((item) => ({
    name: item.name,
    quantity: String(item.quantity),
    unitPrice: `${expectedMoney(item.unitPriceMinor, item.currency)} ${item.currency}`,
    lineTotal: `${expectedMoney(item.lineTotalMinor, item.currency)} ${item.currency}`,
  }));
  const table = page.locator('.order-items-table');
  const mobile = page.locator('.order-items-mobile');
  const metricsOf = (locator: Locator) => locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { display: style.display, visibility: style.visibility, width: rect.width, height: rect.height };
  });
  const tableMetrics = await metricsOf(table);
  const mobileMetrics = await metricsOf(mobile);
  const tableUsable = tableMetrics.display !== 'none' && tableMetrics.visibility !== 'hidden' && tableMetrics.width > 8 && tableMetrics.height > 8;
  const mobileUsable = mobileMetrics.display !== 'none' && mobileMetrics.visibility !== 'hidden' && mobileMetrics.width > 8 && mobileMetrics.height > 8;
  expect(tableUsable).not.toBe(mobileUsable);
  expect(tableUsable || mobileUsable).toBe(true);
  const rows = tableUsable ? table.locator('tbody tr') : mobile.locator('.order-summary-card');
  await expect(rows).toHaveCount(expected.length);
  for (const line of expected) {
    const row = rows.filter({ hasText: line.name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(line.quantity);
    await expect(row).toContainText(line.unitPrice);
    await expect(row).toContainText(line.lineTotal);
    const metrics = await metricsOf(row);
    expect(metrics.display).not.toBe('none');
    expect(metrics.visibility).not.toBe('hidden');
    expect(metrics.width).toBeGreaterThan(8);
    expect(metrics.height).toBeGreaterThan(8);
  }
}

async function tabUntilFocused(page: Page, locator: Locator, limit = 40) {
  for (let index = 0; index < limit; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
}

async function redactVisibleEmails(page: Page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('body *')) {
      if (!node.childElementCount && /@/.test(node.textContent ?? '')) {
        node.textContent = '[redacted-email]';
      }
    }
    for (const field of document.querySelectorAll('input, textarea')) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
      if (/@/.test(field.value)) field.value = '[redacted-email]';
    }
  });
}

async function capturePage(page: Page, locator: Locator, testInfo: TestInfo, filename: string) {
  await redactVisibleEmails(page);
  await locator.screenshot({ path: testInfo.outputPath(filename) });
}

async function addCatalogLine(page: Page, input: { productName: string; quantity: string; variantLabel?: string }) {
  const product = page.locator('.catalog-row').filter({ hasText: input.productName });
  await expect(product).toBeVisible();
  await product.locator('button.catalog-choice').click();
  if (input.variantLabel) await page.getByLabel('Format').selectOption({ label: input.variantLabel });
  await page.locator('#checkout-quantity').fill(input.quantity);
  await page.getByRole('button', { name: 'Add to Order' }).click();
  await expect(page.locator('#checkout-cart')).toContainText(input.productName);
}

function queryLocalOrderGraph(reference: string): {
  status: string;
  history_count: number;
  refund_events: number;
  command_count: number;
  refund_count: number;
} {
  expect(reference).toMatch(/^NX-[A-F0-9]{16}$/);
  const sql = `SELECT o.status AS status,
    (SELECT count(*) FROM order_history h WHERE h.order_id = o.id AND h.store_id = o.store_id) AS history_count,
    (SELECT count(*) FROM order_history h WHERE h.order_id = o.id AND h.action = 'refund_requested') AS refund_events,
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
    refund_events: Number(row.refund_events),
    command_count: Number(row.command_count),
    refund_count: Number(row.refund_count),
  };
}

async function placeOrder(
  page: Page,
  input: { productName: string; quantity: string; variantLabel?: string },
): Promise<{ body: CustomerOrderResponse; capability: string; observedUrls: string[] }> {
  const observedUrls: string[] = [];
  page.on('request', (request) => observedUrls.push(request.url()));

  const product = page.locator('.catalog-row').filter({ hasText: input.productName });
  await expect(product).toBeVisible();
  await product.locator('button.catalog-choice').click();
  if (input.variantLabel) await page.getByLabel('Format').selectOption({ label: input.variantLabel });
  await page.locator('#checkout-quantity').fill(input.quantity);
  await page.getByRole('button', { name: 'Add to Order' }).click();
  await page.getByLabel('Name').fill('Demo Customer');
  await page.getByLabel('Email').fill('demo.customer@example.test');

  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.origin === CONSOLE_ORIGIN && url.pathname === '/api/storefront/orders';
  });
  await page.getByRole('button', { name: 'Place Order' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const body = await createResponse.json() as CustomerOrderResponse;

  expect(body.reference).toMatch(/^NX-[A-F0-9]{16}$/);
  expect(body.status).toBe('pending');
  expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  expect(containsPrivateProjectionKey(body)).toBe(false);

  await expect(page.getByRole('heading', { name: input.productName })).toBeVisible();
  await expect(page.getByText(`Order ${body.reference}`)).toBeVisible();
  await expect(page.locator('.order-status')).toHaveText('Pending');
  const orderUrl = new URL(page.url());
  const capability = new URLSearchParams(orderUrl.hash.slice(1)).get('capability') ?? '';
  expect(orderUrl.origin === STOREFRONT_ORIGIN).toBe(true);
  expect(orderUrl.pathname === `/orders/${body.reference}`).toBe(true);
  expect(orderUrl.search === '').toBe(true);
  expect(capability.length).toBeGreaterThanOrEqual(32);
  expect(JSON.stringify(body).includes(capability)).toBe(false);

  const bodyContainsCapability = await page.locator('body').evaluate((element, secret) => element.textContent?.includes(secret) ?? false, capability);
  expect(bodyContainsCapability).toBe(false);
  expect(observedUrls.some((url) => url.includes(capability) || url.includes(encodeURIComponent(capability)))).toBe(false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: input.productName })).toBeVisible();
  await expect(page.getByText(`Order ${body.reference}`)).toBeVisible();
  expect(observedUrls.some((url) => url.includes(capability) || url.includes(encodeURIComponent(capability)))).toBe(false);

  return { body, capability, observedUrls };
}

test('creates a Simple Order with server authority, fragment-only private reload, and catalog visibility refetch', async ({ page, context }) => {
  const token = uniqueToken();
  const initialName = `Verify E2E Simple ${token}`;
  const editedName = `${initialName} Edited`;
  const editorPath = await createSimpleProduct(page, initialName);

  await page.goto(STOREFRONT_ORIGIN);
  await expect(page.locator('.catalog-row').filter({ hasText: initialName })).toBeVisible();

  const consolePage = await context.newPage();
  await consolePage.bringToFront();
  await consolePage.goto(`${CONSOLE_ORIGIN}${editorPath}`);
  await expect(consolePage.getByLabel('Product name')).toHaveValue(initialName);
  await consolePage.getByLabel('Product name').fill(editedName);
  await visibleSave(consolePage).click();
  await expect(consolePage.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();

  const catalogRefresh = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === CONSOLE_ORIGIN && url.pathname === '/api/storefront/products';
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect((await catalogRefresh).ok()).toBe(true);
  await expect(page.locator('.catalog-row').filter({ hasText: editedName })).toBeVisible();
  await consolePage.close();

  const order = await placeOrder(page, { productName: editedName, quantity: '2' });
  expect(order.body.items[0].product.variant === null).toBe(true);
  expect(order.body.items[0].quantity).toBe(2);
  expect(order.body.items[0].unitPriceMinor).toBe(1995);
  expect(order.body.totalMinor).toBe(3990);
  expect(order.body.currency).toBe('USD');

  const driftedName = `${editedName} Drift`;
  await page.goto(`${CONSOLE_ORIGIN}${editorPath}`);
  await expect(page.getByLabel('Product name')).toHaveValue(editedName);
  await page.getByLabel('Product name').fill(driftedName);
  await visibleSave(page).click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${order.body.reference}`);
  await expect(page.getByRole('heading', { name: order.body.reference })).toBeVisible();
  await expect(page.locator('.order-items-table')).toContainText(editedName);
  await expect(page.locator('.order-items-table')).not.toContainText(driftedName);
});


test('creates an enabled Variant Order and keeps the 375px catalog and private Order within the viewport', async ({ page }) => {
  const token = uniqueToken();
  const productName = `Verify E2E Variant ${token}`;
  await createVariantProduct(page, productName, token);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(STOREFRONT_ORIGIN);
  await expect(page.locator('.catalog-row').filter({ hasText: productName })).toBeVisible();
  await expectNoHorizontalOverflow(page, 375);

  const order = await placeOrder(page, { productName, quantity: '2', variantLabel: 'PDF' });
  expect(order.body.items[0].product.variant !== null).toBe(true);
  expect(order.body.items[0].product.variant?.selectedOptions.some((option) => option.groupName === 'Format' && option.valueLabel === 'PDF')).toBe(true);
  expect(order.body.items[0].product.variant?.sku.endsWith('-PDF')).toBe(true);
  expect(order.body.items[0].quantity).toBe(2);
  expect(order.body.items[0].unitPriceMinor).toBe(3950);
  expect(order.body.totalMinor).toBe(7900);
  expect(order.body.currency).toBe('USD');
  await expectNoHorizontalOverflow(page, 375);
});

test('does not show a refund form on pending or cancelled private Orders', async ({ page }) => {
  const paidName = `Verify E2E Pending ${uniqueToken()}`;
  const zeroName = `Verify E2E Pending Zero ${uniqueToken()}`;
  await createSimpleProduct(page, paidName);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, zeroName, '0.00');
  await visibleSave(page).click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();

  await page.goto(STOREFRONT_ORIGIN);
  const pendingPaid = await placeOrder(page, { productName: paidName, quantity: '1' });
  expect(pendingPaid.body.totalMinor).toBeGreaterThan(0);
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);
  await cancelOrder(page, pendingPaid.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This Order has been canceled.')).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Payment next step' })).toHaveCount(0);

  await page.goto(STOREFRONT_ORIGIN);
  const pendingZero = await placeOrder(page, { productName: zeroName, quantity: '1' });
  expect(pendingZero.body.totalMinor).toBe(0);
  await cancelOrder(page, pendingZero.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This Order has been canceled.')).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);
});

test('requests a refund on completed zero and paid Orders without overflowing 375px', async ({ page }) => {
  const paidName = `Verify E2E Refund Paid ${uniqueToken()}`;
  await createSimpleProduct(page, paidName);
  await page.goto(STOREFRONT_ORIGIN);
  const paid = await placeOrder(page, { productName: paidName, quantity: '1' });
  await completeOrder(page, paid.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This Order is paid. This page does not deliver files or pay out a refund.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment next step' })).toHaveCount(0);

  await page.getByLabel('Reason for refund request').fill('Please reverse this purchase.');
  const refundResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === `/api/storefront/orders/${paid.body.reference}/refund-requests`;
  });
  await page.getByRole('button', { name: 'Send refund request' }).click();
  const refundResponse = await refundResponsePromise;
  expect(refundResponse.status()).toBe(200);
  const refundBody = await refundResponse.json() as { refundRequest: { reason: string } };
  expect(refundBody.refundRequest.reason).toBe('Please reverse this purchase.');
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  await expect(page.getByText('Please reverse this purchase.')).toBeVisible();
  await expect(page.getByText('Your request is pending. No refund has been issued.')).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);

  const zeroName = `Verify E2E Refund Zero ${uniqueToken()}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, zeroName, '0.00');
  await visibleSave(page).click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  await page.goto(STOREFRONT_ORIGIN);
  const zero = await placeOrder(page, { productName: zeroName, quantity: '1' });
  expect(zero.body.totalMinor).toBe(0);
  await completeOrder(page, zero.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Reason for refund request')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Reason for refund request').fill('Zero total still needs a refund path.');
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 375);
});

test('canonicalizes a two-line refund reason and shows it on the Console pending filter', async ({ page }) => {
  const name = `Verify E2E Reason ${uniqueToken()}`;
  await createSimpleProduct(page, name);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, { productName: name, quantity: '1' });
  await completeOrder(page, placed.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Reason for refund request')).toBeVisible();

  const rawReason = '  Wrong format\nPlease review.  ';
  const canonical = 'Wrong format\nPlease review.';
  await page.getByLabel('Reason for refund request').fill(rawReason);
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  await expect(page.getByText(canonical, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  await expect(page.getByText(canonical, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);

  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await page.getByLabel('Search Orders').fill(placed.body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Pending refund requests').check();
  await expect(page.getByRole('link', { name: placed.body.reference })).toBeVisible();
  await page.getByRole('link', { name: placed.body.reference }).click();
  await expect(page.getByRole('heading', { name: placed.body.reference })).toBeVisible();
  await expect(page.getByText(canonical, { exact: true })).toBeVisible();
  await expect(page.getByText('Refund request pending').first()).toBeVisible();
});

test('retries a committed refund after response loss without a second D1 row', async ({ page }) => {
  const name = `Verify E2E Refund Loss ${uniqueToken()}`;
  await createSimpleProduct(page, name);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, { productName: name, quantity: '1' });
  await completeOrder(page, placed.body.reference);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const keys: string[] = [];
  await page.route(`**/api/storefront/orders/${placed.body.reference}/refund-requests`, async (route) => {
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

  await page.getByLabel('Reason for refund request').fill('Keep this identity.');
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await expect(page.getByText('The outcome is not confirmed. Retry the same request.')).toBeVisible();

  const afterCommit = queryLocalOrderGraph(placed.body.reference);
  expect(afterCommit).toMatchObject({
    status: 'paid',
    refund_events: 1,
    refund_count: 1,
  });

  await page.getByRole('button', { name: 'Retry refund request' }).focus();
  await expect(page.getByRole('button', { name: 'Retry refund request' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(queryLocalOrderGraph(placed.body.reference)).toEqual(afterCommit);
});

test('reaches the refund textarea by keyboard on 375px without overflow', async ({ page }, testInfo) => {
  const name = `Verify E2E Keys ${uniqueToken()}`;
  await createSimpleProduct(page, name);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, { productName: name, quantity: '1' });
  await completeOrder(page, placed.body.reference);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Reason for refund request').focus();
  await expect(page.getByLabel('Reason for refund request')).toBeFocused();
  await page.keyboard.type('Keyboard path.');
  await expectNoHorizontalOverflow(page, 375);
  await redactVisibleEmails(page);
  await page.locator('.order-ledger').screenshot({ path: testInfo.outputPath('ui-01-storefront-refund-375.png') });
});

test('places one Order with a Simple and Variant Product, then Marks Paid, Fulfills, and canonicalizes a Customer refund', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const token = uniqueToken();
  const simpleName = `Verify E2E Two Simple ${token}`;
  const variantName = `Verify E2E Two Variant ${token}`;
  await createSimpleProduct(page, simpleName);
  await createVariantProduct(page, variantName, token);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(STOREFRONT_ORIGIN);
  await addCatalogLine(page, { productName: simpleName, quantity: '1' });
  await addCatalogLine(page, { productName: variantName, quantity: '1', variantLabel: 'PDF' });
  await page.getByLabel('Name').fill('Two Line Customer');
  await page.getByLabel('Email').fill('two.line.customer@example.test');
  await page.locator('#checkout-quantity').focus();
  await tabUntilFocused(page, page.getByLabel('Name'));
  await tabUntilFocused(page, page.getByLabel('Email'));
  await expectNoHorizontalOverflow(page, 1280);
  await capturePage(page, page.locator('.purchase-ledger'), testInfo, 'ui-02-storefront-cart-1280.png');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('#checkout-cart')).toContainText(simpleName);
  await expect(page.locator('#checkout-cart')).toContainText(variantName);
  await expectNoHorizontalOverflow(page, 375);
  await capturePage(page, page.locator('.purchase-ledger'), testInfo, 'ui-02-storefront-cart-375.png');

  await page.setViewportSize({ width: 1280, height: 900 });
  const createPosts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.origin === CONSOLE_ORIGIN && url.pathname === '/api/storefront/orders') {
      createPosts.push(request.url());
    }
  });
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.origin === CONSOLE_ORIGIN && url.pathname === '/api/storefront/orders';
  });
  await page.getByRole('button', { name: 'Place Order' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const body = await createResponse.json() as CustomerOrderResponse;
  expect(body.items).toHaveLength(2);
  expect(body.items.map((item) => item.product.name).sort()).toEqual([simpleName, variantName].sort());
  expect(body.items.some((item) => item.product.variant === null)).toBe(true);
  expect(body.items.some((item) => item.product.variant?.selectedOptions.some((option) => option.groupName === 'Format' && option.valueLabel === 'PDF'))).toBe(true);
  expect(body.totalMinor).toBe(1995 + 3950);
  expect(body.currency).toBe('USD');
  expect(body.paymentReference.length).toBeGreaterThan(0);
  expect(containsPrivateProjectionKey(body)).toBe(false);
  expect(createPosts).toHaveLength(1);

  await expect(page.getByText(`Order ${body.reference}`)).toBeVisible();
  await expect(page.locator('.order-item-list')).toContainText(simpleName);
  await expect(page.locator('.order-item-list')).toContainText(variantName);
  await expect(page.getByText(body.paymentReference)).toBeVisible();
  await expect(page.locator('.total-line')).toContainText('$59.45');
  await expectNoHorizontalOverflow(page, 1280);
  await capturePage(page, page.locator('.order-ledger'), testInfo, 'ui-02-storefront-private-1280.png');
  const privateUrl = new URL(page.url());
  const capability = new URLSearchParams(privateUrl.hash.slice(1)).get('capability') ?? '';
  expect(privateUrl.origin).toBe(STOREFRONT_ORIGIN);
  expect(privateUrl.pathname).toBe(`/orders/${body.reference}`);
  expect(capability.length).toBeGreaterThanOrEqual(32);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.order-item-list')).toContainText(simpleName);
  await expectNoHorizontalOverflow(page, 375);
  await capturePage(page, page.locator('.order-ledger'), testInfo, 'ui-02-storefront-private-375.png');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.getByLabel('Search Orders').fill(body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: body.reference })).toBeVisible();
  await expect(page.locator('.orders-table, .order-summary-card').first()).toContainText('+ 1 more');
  await expect(page.getByText(body.paymentReference).first()).toBeVisible();
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-02-console-inbox-1280.png');

  await page.getByRole('link', { name: body.reference }).click();
  await expect(page.getByRole('heading', { name: body.reference })).toBeVisible();
  await expectUsableOrderItemSnapshots(page, orderItemLines(body));
  await expect(page.getByText(body.paymentReference).first()).toBeVisible();
  await expect(page.locator('.order-total').first()).toContainText('$59.45');
  await tabUntilFocused(page, page.getByRole('button', { name: 'Record manual payment' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Record manual payment' })).toBeVisible();
  await tabUntilFocused(page, page.getByLabel('Payment method'));
  await page.getByLabel('Payment method').fill('Bank transfer');
  await tabUntilFocused(page, page.getByLabel('External payment reference'));
  await page.getByLabel('External payment reference').fill(`WIRE-${body.reference.slice(-8)}`);
  await tabUntilFocused(page, page.getByLabel('I confirm an external receipt exists for this exact total and currency.'));
  await page.keyboard.press('Space');
  await expectNoHorizontalOverflow(page, 1280);
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-03-console-detail-1280.png');
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.locator('.status-tag.status-active')).toContainText('Paid');
  await page.getByRole('button', { name: 'Fulfill' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm Fulfill' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Fulfill' }).click();
  await expect(page.locator('.status-tag.status-active')).toContainText('Fulfilled');
  await expect(page.getByText('This is an operational status change only')).toHaveCount(0);
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-02-console-fulfilled-1280.png');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await page.getByLabel('Search Orders').fill(body.reference);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: body.reference })).toBeVisible();
  await expectNoHorizontalOverflow(page, 375);
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-02-console-inbox-375.png');
  await page.getByRole('link', { name: body.reference }).click();
  await expect(page.getByRole('heading', { name: body.reference })).toBeVisible();
  await expectUsableOrderItemSnapshots(page, orderItemLines(body));
  await expectNoHorizontalOverflow(page, 375);
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-03-console-detail-375.png');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${STOREFRONT_ORIGIN}/orders/${encodeURIComponent(body.reference)}#capability=${encodeURIComponent(capability)}`);
  await expect(page.locator('.order-status')).toHaveText('Fulfilled');
  await expect(page.getByText('This Order is fulfilled. This page does not deliver files or pay out a refund.')).toBeVisible();
  await expect(page.locator('.order-item-list')).toContainText(simpleName);
  await expect(page.locator('.order-item-list')).toContainText(variantName);
  await expect(page.getByText(body.paymentReference)).toBeVisible();
  const refundReason = 'Customer asks to reverse this two-product Order.';
  await page.getByRole('button', { name: 'Back to catalog' }).focus();
  await tabUntilFocused(page, page.getByLabel('Reason for refund request'));
  await page.getByLabel('Reason for refund request').fill(refundReason);
  await page.getByRole('button', { name: 'Send refund request' }).click();
  await expect(page.getByRole('heading', { name: 'Refund request pending' })).toBeVisible();
  await expect(page.getByText(refundReason)).toBeVisible();
  await expect(page.getByLabel('Reason for refund request')).toHaveCount(0);
  await capturePage(page, page.locator('.order-ledger'), testInfo, 'ui-02-storefront-refund-1280.png');

  await page.goto(`${CONSOLE_ORIGIN}/console/orders/${body.reference}`);
  await expect(page.getByRole('heading', { name: body.reference })).toBeVisible();
  await expect(page.getByText(refundReason, { exact: true })).toBeVisible();
  await expect(page.getByText('Refund request pending').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request refund for Customer' })).toHaveCount(0);
  await expect(page.locator('#console-refund-reason')).toHaveCount(0);
  await capturePage(page, page.locator('.page-stack'), testInfo, 'ui-02-console-existing-refund-1280.png');
});
