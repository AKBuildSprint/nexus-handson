import { expect, test, type Page } from '@playwright/test';

const CONSOLE_ORIGIN = process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173';
const STOREFRONT_ORIGIN = process.env.PLAYWRIGHT_STOREFRONT_BASE_URL ?? 'http://127.0.0.1:5174';

interface OrderResponse {
  reference: string;
  status: 'pending_payment' | 'completed' | 'cancelled';
  product: {
    name: string;
    variant: null | {
      sku: string;
      selectedOptions: Array<{ groupName: string; valueLabel: string }>;
    };
  };
  quantity: number;
  unitPriceMinor: number;
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
  await page.getByLabel('Quantity').fill('1');
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
  expect(body.status).toBe('pending_payment');
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
  expect(simpleOrder.body.product.variant === null).toBe(true);
  expect(simpleOrder.body.unitPriceMinor).toBe(2125);
  expect(simpleOrder.body.totalMinor).toBe(2125);

  await page.getByRole('button', { name: 'Back to catalog' }).click();
  await expect(page.locator('.catalog-row').filter({ hasText: variantName })).toBeVisible();
  const variantOrder = await placeOrder(page, variantName, 'PDF');
  expect(variantOrder.body.product.variant !== null).toBe(true);
  expect(variantOrder.body.product.variant?.selectedOptions.some((option) => option.groupName === 'Format' && option.valueLabel === 'PDF')).toBe(true);
  expect(variantOrder.body.unitPriceMinor).toBe(4175);
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
  const journeyOrderCount = projection.orders.filter((order) => order.product.name === simpleName || order.product.name === variantName).length;
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
  await expect(variantRow).toContainText('Pending payment');

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
  await expect(variantCard).toContainText('Pending payment');
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
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('I confirm the full payment has been received.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm Complete' })).toBeDisabled();
  await page.getByLabel('I confirm the full payment has been received.').check();
  await page.getByRole('button', { name: 'Confirm Complete' }).click();
  await expect(page.locator('.status-tag.status-active')).toContainText('Completed');
}

test('completes zero-total and paid Orders, restores detail via reload and popstate, and conflicts a stale cancel', async ({ page, context }) => {
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

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Confirm Cancel' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The action was not applied. The Order has changed.' })).toBeVisible();
  await expect(page.locator('.status-tag.status-active')).toContainText('Completed');

  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await page.getByRole('tab', { name: 'Pending payment' }).click();
  await expect(page.getByRole('link', { name: paidOrder.body.reference })).toHaveCount(0);
  await expect(page.getByRole('link', { name: staleOrder.body.reference })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Completed' }).click();
  await expect(page.getByRole('link', { name: paidOrder.body.reference })).toBeVisible();
  await expect(page.getByRole('link', { name: zeroOrder.body.reference })).toBeVisible();
});
