import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CONSOLE_ORIGIN = process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173';
const STOREFRONT_ORIGIN = process.env.PLAYWRIGHT_STOREFRONT_BASE_URL ?? 'http://127.0.0.1:5174';
const PRIVATE_PROJECTION_KEYS: Record<string, true> = {
  capability: true,
  privateurl: true,
  privatefilekey: true,
  deliveryfilekey: true,
  deliveryaccessinstructions: true,
  accessinstructions: true,
};

interface CustomerOrderResponse {
  reference: string;
  status: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';
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
  paymentNextStep: string | null;
  refundRequest?: { id: string; reason: string; status: 'pending'; createdAt: string } | null;
}

interface ConsoleOrderDetail {
  reference: string;
  status: CustomerOrderResponse['status'];
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  history: Array<{ sequence: number; action: string; refundRequestId: string | null }>;
  refundRequest: { id: string; reason: string; status: 'pending'; createdAt: string } | null;
}

function uniqueToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function searchAndOpenOrder(page: Page, reference: string) {
  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  const list = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.origin === CONSOLE_ORIGIN
      && url.pathname === '/api/console/orders'
      && url.searchParams.get('q') === reference;
  });
  await page.getByLabel('Search Orders').fill(reference);
  expect((await list).ok()).toBe(true);
  await page.getByRole('link', { name: reference }).click();
  await expect(page.getByRole('heading', { name: reference })).toBeVisible();
}

async function readConsoleDetail(request: APIRequestContext, reference: string): Promise<ConsoleOrderDetail> {
  const response = await request.get(`${CONSOLE_ORIGIN}/api/console/orders/${encodeURIComponent(reference)}`, {
    headers: { Accept: 'application/json' },
  });
  expect(response.ok()).toBe(true);
  return await response.json() as ConsoleOrderDetail;
}

async function readPrivateOrder(request: APIRequestContext, reference: string, capability: string): Promise<CustomerOrderResponse> {
  const response = await request.get(`${CONSOLE_ORIGIN}/api/storefront/orders/${encodeURIComponent(reference)}`, {
    headers: {
      Accept: 'application/json',
      'X-Nexus-Order-Capability': capability,
    },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as CustomerOrderResponse;
  expect(JSON.stringify(body).includes(capability)).toBe(false);
  expect(containsPrivateProjectionKey(body)).toBe(false);
  return body;
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
  return Object.entries(value).some(
    ([key, child]) => Object.hasOwn(PRIVATE_PROJECTION_KEYS, key.toLowerCase()) || containsPrivateProjectionKey(child),
  );
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

async function placeOrder(
  page: Page,
  input: { productName: string; quantity: string; variantLabel?: string },
): Promise<{ body: CustomerOrderResponse; capability: string }> {
  const observedUrls: string[] = [];
  page.on('request', (request) => observedUrls.push(request.url()));

  const product = page.locator('.catalog-row').filter({ hasText: input.productName });
  await expect(product).toBeVisible();
  await product.locator('button.catalog-choice').click();
  if (input.variantLabel) await page.getByLabel('Format').selectOption({ label: input.variantLabel });
  await page.getByLabel('Quantity').fill(input.quantity);
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
  expect(body.status).toBe('pending_payment');
  expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  expect(containsPrivateProjectionKey(body)).toBe(false);

  await expect(page.getByRole('heading', { name: input.productName })).toBeVisible();
  await expect(page.getByText(`Order ${body.reference}`)).toBeVisible();
  await expect(page.getByText('Pending payment')).toBeVisible();

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

  return { body, capability };
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
  expect(order.body.product.variant === null).toBe(true);
  expect(order.body.quantity).toBe(2);
  expect(order.body.unitPriceMinor).toBe(1995);
  expect(order.body.totalMinor).toBe(3990);
  expect(order.body.currency).toBe('USD');
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
  expect(order.body.product.variant !== null).toBe(true);
  expect(order.body.product.variant?.selectedOptions.some((option) => option.groupName === 'Format' && option.valueLabel === 'PDF')).toBe(true);
  expect(order.body.product.variant?.sku.endsWith('-PDF')).toBe(true);
  expect(order.body.quantity).toBe(2);
  expect(order.body.unitPriceMinor).toBe(3950);
  expect(order.body.totalMinor).toBe(7900);
  expect(order.body.currency).toBe('USD');
  await expectNoHorizontalOverflow(page, 375);
});

test('ST02 Cancel remains privately readable and exposes no Refund form', async ({ page, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 ST02 ${token}`;
  await createSimpleProduct(page, productName);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, { productName, quantity: '1' });
  const before = await readConsoleDetail(request, placed.body.reference);
  expect(before.status).toBe('pending_payment');
  expect(before.history.map((entry) => entry.action)).toEqual(['order_created']);

  const consolePage = await page.context().newPage();
  await searchAndOpenOrder(consolePage, placed.body.reference);
  await consolePage.getByRole('button', { name: 'Cancel' }).click();
  await expect(consolePage.locator('.status-tag')).toHaveText('Cancelled');
  const cancelled = await readConsoleDetail(request, placed.body.reference);
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.history.map((entry) => entry.action)).toEqual(['order_created', 'cancel']);
  expect(cancelled.history.filter((entry) => entry.action === 'cancel')).toHaveLength(1);
  expect(cancelled.refundRequest).toBeNull();
  expect(cancelled.quantity).toBe(before.quantity);
  expect(cancelled.unitPriceMinor).toBe(before.unitPriceMinor);
  expect(cancelled.totalMinor).toBe(before.totalMinor);
  await consolePage.close();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(`Order ${placed.body.reference}`)).toBeVisible();
  await expect(page.locator('.order-status')).toHaveText('Cancelled');
  await expect(page.getByRole('heading', { name: 'Refund Request' })).toHaveCount(0);
  await expect(page.getByLabel('Reason')).toHaveCount(0);
  const privateRead = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(privateRead.status).toBe('cancelled');
  expect(privateRead.refundRequest ?? null).toBeNull();
  expect(privateRead.paymentNextStep).toBeNull();
});

test('ST03 US02 Customer refund is durable across Console refresh and a new browser context', async ({ page, browser, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 ST03 ${token}`;
  const reason = `<script>alert(1)</script> please reverse ${token}`;
  await createSimpleProduct(page, productName);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, { productName, quantity: '1' });
  const privateUrl = page.url();

  const consolePage = await page.context().newPage();
  await searchAndOpenOrder(consolePage, placed.body.reference);
  await consolePage.getByRole('button', { name: 'Mark paid' }).click();
  await expect(consolePage.locator('.status-tag')).toHaveText('Paid');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.order-status')).toHaveText('Paid');
  await page.getByLabel('Reason').fill(reason);
  await page.getByRole('button', { name: 'Request refund' }).click();
  await expect(page.getByText('Received — awaiting response')).toBeVisible();
  const reasonNode = page.locator('[data-refund-reason]');
  await expect(reasonNode).toHaveText(reason);
  expect(await reasonNode.locator('script').count()).toBe(0);

  const privateAfter = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(privateAfter.status).toBe('paid');
  expect(privateAfter.refundRequest?.reason).toBe(reason);
  expect(privateAfter.refundRequest?.status).toBe('pending');
  const refundId = privateAfter.refundRequest?.id ?? '';
  expect(refundId).toMatch(/^refund_[a-f0-9]{32}$/);

  await consolePage.reload({ waitUntil: 'domcontentloaded' });
  await expect(consolePage.getByText('Received — awaiting response')).toBeVisible();
  const consoleReason = consolePage.locator('.notice-warning [data-refund-reason]');
  await expect(consoleReason).toHaveText(reason);
  expect(await consoleReason.locator('script').count()).toBe(0);
  const consoleAfter = await readConsoleDetail(request, placed.body.reference);
  expect(consoleAfter.status).toBe('paid');
  expect(consoleAfter.refundRequest?.id).toBe(refundId);
  expect(consoleAfter.refundRequest?.reason).toBe(reason);
  expect(consoleAfter.refundRequest?.createdAt).toBe(privateAfter.refundRequest?.createdAt);
  expect(consoleAfter.history.filter((entry) => entry.action === 'refund_requested')).toHaveLength(1);
  expect(consoleAfter.history.find((entry) => entry.action === 'refund_requested')?.refundRequestId).toBe(refundId);
  await consolePage.close();

  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.goto(privateUrl);
  await expect(freshPage.getByText(`Order ${placed.body.reference}`)).toBeVisible();
  await expect(freshPage.getByText('Received — awaiting response')).toBeVisible();
  await expect(freshPage.locator('[data-refund-reason]')).toHaveText(reason);
  await expect(freshPage.getByLabel('Reason')).toHaveCount(0);
  const freshRead = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(freshRead.refundRequest?.id).toBe(refundId);
  expect(freshRead.refundRequest?.reason).toBe(reason);
  expect(freshRead.refundRequest?.createdAt).toBe(privateAfter.refundRequest?.createdAt);
  await freshContext.close();
});
