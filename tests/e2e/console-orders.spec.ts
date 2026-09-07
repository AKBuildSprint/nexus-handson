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

type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';

interface OrderResponse {
  reference: string;
  status: OrderStatus;
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
}

interface OrderHistoryEntry {
  sequence: number;
  action: 'order_created' | 'mark_paid' | 'mark_fulfilled' | 'cancel' | 'refund_requested';
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: 'storefront' | 'console';
  refundRequestId: string | null;
  createdAt: string;
}

interface OrderRefundRequest {
  id: string;
  reason: string;
  status: 'pending';
  createdAt: string;
}

interface ConsoleOrderDetail {
  reference: string;
  status: OrderStatus;
  product: OrderResponse['product'] & { id: string };
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  customer: { name: string; email: string };
  history: OrderHistoryEntry[];
  refundRequest: OrderRefundRequest | null;
  allowedActions: Array<'mark_paid' | 'mark_fulfilled' | 'cancel'>;
}

interface PrivateOrderView {
  reference: string;
  status: OrderStatus;
  product: ConsoleOrderDetail['product'];
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  paymentNextStep: string | null;
  refundRequest: OrderRefundRequest | null;
}

function uniqueToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function opaqueToken(length = 43): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function purchaseFields(order: {
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  product: { name: string };
}) {
  return {
    name: order.product.name,
    quantity: order.quantity,
    unitPriceMinor: order.unitPriceMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    createdAt: order.createdAt,
  };
}

function historyActions(detail: ConsoleOrderDetail): OrderHistoryEntry['action'][] {
  return [...detail.history].sort((left, right) => left.sequence - right.sequence).map((entry) => entry.action);
}

async function readConsoleDetail(request: APIRequestContext, reference: string): Promise<ConsoleOrderDetail> {
  const response = await request.get(`${CONSOLE_ORIGIN}/api/console/orders/${encodeURIComponent(reference)}`, {
    headers: { Accept: 'application/json' },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as ConsoleOrderDetail;
  expect(containsPrivateProjectionKey(body)).toBe(false);
  return body;
}

async function readPrivateOrder(request: APIRequestContext, reference: string, capability: string): Promise<PrivateOrderView> {
  const response = await request.get(`${CONSOLE_ORIGIN}/api/storefront/orders/${encodeURIComponent(reference)}`, {
    headers: {
      Accept: 'application/json',
      'X-Nexus-Order-Capability': capability,
    },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as PrivateOrderView;
  expect(containsPrivateProjectionKey(body)).toBe(false);
  expect(JSON.stringify(body).includes(capability)).toBe(false);
  return body;
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

async function catalogProductId(request: APIRequestContext, productName: string): Promise<string> {
  const response = await request.get(`${CONSOLE_ORIGIN}/api/storefront/products`, {
    headers: { Accept: 'application/json' },
  });
  expect(response.ok()).toBe(true);
  const catalog = await response.json() as { products: Array<{ id: string; name: string }> };
  const product = catalog.products.find((entry) => entry.name === productName);
  expect(product).toBeTruthy();
  return product!.id;
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

async function createSimpleProduct(page: Page, name: string) {
  await page.goto(`${CONSOLE_ORIGIN}/console/products/new`);
  await fillRequiredProduct(page, name, '21.25');
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
  const serializedProjection = JSON.stringify(projection);
  const journeyOrderCount = projection.orders.filter((order) => order.product.name === simpleName || order.product.name === variantName).length;
  expect(journeyOrderCount).toBe(2);
  expect(containsPrivateProjectionKey(projection)).toBe(false);
  expect(capabilities.some((secret) => serializedProjection.includes(secret))).toBe(false);
  expect(serializedProjection.includes('Use the private delivery package after payment.')).toBe(false);

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

test('ST01 search to detail Paid then Fulfilled is visible on both origins after refresh', async ({ page, context, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 ST01 ${token}`;
  await createSimpleProduct(page, productName);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, productName);
  const privateUrl = page.url();
  const baselineConsole = await readConsoleDetail(request, placed.body.reference);
  const baselinePrivate = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(baselineConsole.status).toBe('pending_payment');
  expect(baselinePrivate.status).toBe('pending_payment');
  expect(baselinePrivate.paymentNextStep).toBe('Payment instructions will be provided separately.');
  expect(purchaseFields(baselineConsole)).toEqual(purchaseFields(placed.body));
  expect(historyActions(baselineConsole)).toEqual(['order_created']);

  const customerPage = await context.newPage();
  await customerPage.goto(privateUrl);
  await expect(customerPage.getByText('Pending payment')).toBeVisible();
  await expect(customerPage.getByRole('heading', { name: 'Payment next step' })).toBeVisible();

  await searchAndOpenOrder(page, placed.body.reference);
  const actionUrl = `${CONSOLE_ORIGIN}/api/console/orders/${placed.body.reference}/actions`;
  let firstPaidAttempt = true;
  let paidKey: string | null = null;
  await page.route(actionUrl, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const key = route.request().headers()['idempotency-key'] ?? null;
    if (firstPaidAttempt) {
      firstPaidAttempt = false;
      paidKey = key;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    expect(key).toBe(paidKey);
    await route.continue();
  });
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('The Order could not be updated')).toBeVisible();
  await page.getByRole('button', { name: 'Retry Mark paid' }).click();
  await expect(page.locator('.status-tag')).toHaveText('Paid');
  await page.unroute(actionUrl);

  const paidConsole = await readConsoleDetail(request, placed.body.reference);
  const paidPrivate = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(paidConsole.status).toBe('paid');
  expect(paidPrivate.status).toBe('paid');
  expect(paidPrivate.paymentNextStep).toBeNull();
  expect(purchaseFields(paidConsole)).toEqual(purchaseFields(baselineConsole));
  expect(historyActions(paidConsole)).toEqual(['order_created', 'mark_paid']);
  expect(paidConsole.history.filter((entry) => entry.action === 'mark_paid')).toHaveLength(1);

  await customerPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(customerPage.locator('.order-status')).toHaveText('Paid');
  await expect(customerPage.getByRole('heading', { name: 'Payment next step' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark fulfilled' }).click();
  await expect(page.locator('.status-tag')).toHaveText('Fulfilled');
  const fulfilledConsole = await readConsoleDetail(request, placed.body.reference);
  const fulfilledPrivate = await readPrivateOrder(request, placed.body.reference, placed.capability);
  expect(fulfilledConsole.status).toBe('fulfilled');
  expect(fulfilledPrivate.status).toBe('fulfilled');
  expect(fulfilledPrivate.paymentNextStep).toBeNull();
  expect(purchaseFields(fulfilledConsole)).toEqual(purchaseFields(baselineConsole));
  expect(historyActions(fulfilledConsole)).toEqual(['order_created', 'mark_paid', 'mark_fulfilled']);

  await customerPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(customerPage.locator('.order-status')).toHaveText('Fulfilled');
  await expect(customerPage.getByRole('heading', { name: 'Payment next step' })).toHaveCount(0);
  await customerPage.close();
});

test('ST05 stale Cancel conflicts and IT02 delayed pending GET cannot roll Paid back', async ({ page, context, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 ST05 ${token}`;
  await createSimpleProduct(page, productName);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, productName);
  const detailPath = `/api/console/orders/${placed.body.reference}`;

  const staleTab = await context.newPage();
  await searchAndOpenOrder(staleTab, placed.body.reference);
  await expect(staleTab.getByRole('button', { name: 'Cancel' })).toBeVisible();

  await searchAndOpenOrder(page, placed.body.reference);
  await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible();

  let releaseStale: () => void = () => undefined;
  const holdStale = new Promise<void>((resolve) => { releaseStale = resolve; });
  let markCaptured: () => void = () => undefined;
  const staleCaptured = new Promise<void>((resolve) => { markCaptured = resolve; });
  let markDelivered: () => void = () => undefined;
  const staleDelivered = new Promise<void>((resolve) => { markDelivered = resolve; });
  let holdNextPendingGet = false;
  await page.route((url) => url.origin === CONSOLE_ORIGIN && url.pathname === detailPath, async (route) => {
    if (route.request().method() !== 'GET' || !holdNextPendingGet) {
      await route.continue();
      return;
    }
    holdNextPendingGet = false;
    const pendingResponse = await route.fetch();
    const pendingText = await pendingResponse.text();
    const pendingBody = JSON.parse(pendingText) as ConsoleOrderDetail;
    expect(pendingBody.status).toBe('pending_payment');
    markCaptured();
    await holdStale;
    await route.fulfill({
      status: pendingResponse.status(),
      headers: pendingResponse.headers(),
      body: pendingText,
    });
    markDelivered();
  });
  holdNextPendingGet = true;
  await page.evaluate(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  });
  await staleCaptured;
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.locator('.status-tag')).toHaveText('Paid');
  const paidAfterB = await readConsoleDetail(request, placed.body.reference);
  expect(paidAfterB.status).toBe('paid');
  expect(historyActions(paidAfterB)).toEqual(['order_created', 'mark_paid']);
  releaseStale();
  await staleDelivered;
  await page.evaluate(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));
  await expect(page.locator('.status-tag')).toHaveText('Paid');
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark fulfilled' })).toBeVisible();

  await staleTab.getByRole('button', { name: 'Cancel' }).click();
  await expect(staleTab.getByText('The Order could not be updated')).toBeVisible();
  await expect(staleTab.locator('.status-tag')).toHaveText('Paid');
  await expect(staleTab.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(staleTab.getByRole('button', { name: 'Mark fulfilled' })).toBeVisible();
  const afterConflict = await readConsoleDetail(request, placed.body.reference);
  expect(afterConflict.status).toBe('paid');
  expect(historyActions(afterConflict)).toEqual(['order_created', 'mark_paid']);
  expect(purchaseFields(afterConflict)).toEqual(purchaseFields(paidAfterB));
  await staleTab.close();
});

test('BL02 EN01 unconfirmed Fulfill is blocked at 375px keyboard then confirm keeps refund pending', async ({ page, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 BL02 ${token}`;
  const reason = `Please reverse ST03 ${token}`;
  await createSimpleProduct(page, productName);
  await page.goto(STOREFRONT_ORIGIN);
  const placed = await placeOrder(page, productName);
  await searchAndOpenOrder(page, placed.body.reference);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.locator('.status-tag')).toHaveText('Paid');

  const refund = await page.request.post(`${CONSOLE_ORIGIN}/api/storefront/orders/${placed.body.reference}/refund-requests`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': `refundkey-${token}-bl02xx`,
      'X-Nexus-Order-Capability': placed.capability,
    },
    data: { reason },
  });
  expect(refund.status()).toBe(201);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Received — awaiting response')).toBeVisible();
  const before = await readConsoleDetail(request, placed.body.reference);
  expect(before.refundRequest?.id).toMatch(/^refund_[a-f0-9]{32}$/);
  expect(before.refundRequest?.reason).toBe(reason);
  expect(before.refundRequest?.status).toBe('pending');

  await page.setViewportSize({ width: 375, height: 812 });
  const posts: string[] = [];
  await page.route((url) => url.origin === CONSOLE_ORIGIN && url.pathname === `/api/console/orders/${placed.body.reference}/actions`, async (route) => {
    if (route.request().method() === 'POST') posts.push(route.request().postData() ?? '');
    await route.continue();
  });
  await page.getByRole('button', { name: 'Mark fulfilled' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Confirm fulfillment' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(reason)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([]);
  await page.getByRole('button', { name: 'Mark fulfilled' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([]);
  const stillPaid = await readConsoleDetail(request, placed.body.reference);
  expect(stillPaid.status).toBe('paid');
  expect(stillPaid.refundRequest?.id).toBe(before.refundRequest?.id);

  await page.getByRole('button', { name: 'Mark fulfilled' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm fulfillment' }).click();
  await expect(page.locator('.status-tag')).toHaveText('Fulfilled');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]) as { action: string; acknowledgedRefundRequestId: string | null }).toEqual({
    action: 'mark_fulfilled',
    acknowledgedRefundRequestId: before.refundRequest?.id ?? null,
  });
  const fulfilled = await readConsoleDetail(request, placed.body.reference);
  expect(fulfilled.status).toBe('fulfilled');
  expect(fulfilled.refundRequest?.id).toBe(before.refundRequest?.id);
  expect(fulfilled.refundRequest?.reason).toBe(reason);
  expect(fulfilled.refundRequest?.status).toBe('pending');
  expect(fulfilled.refundRequest?.createdAt).toBe(before.refundRequest?.createdAt);
  expect(historyActions(fulfilled)).toEqual(['order_created', 'mark_paid', 'refund_requested', 'mark_fulfilled']);
});

test('R5 page 3 detail actual reload Back Previous restores page 2 under the same criteria', async ({ page, request }) => {
  const token = uniqueToken();
  const productName = `Verify S3 R5 ${token}`;
  await createSimpleProduct(page, productName);
  const productId = await catalogProductId(request, productName);
  const created: string[] = [];
  for (let index = 0; index < 51; index += 1) {
    const response = await request.post(`${CONSOLE_ORIGIN}/api/storefront/orders`, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': `r5key-${token}-${String(index).padStart(2, '0')}xx`,
        'X-Nexus-Order-Capability': opaqueToken(),
      },
      data: {
        customer: { name: `Pager ${token}`, email: `pager.${token}.${index}@example.test` },
        productId,
        variantId: null,
        quantity: 1,
      },
    });
    expect(response.status()).toBe(201);
    created.push(((await response.json()) as OrderResponse).reference);
  }
  expect(created).toHaveLength(51);

  await page.goto(`${CONSOLE_ORIGIN}/console/orders`);
  const firstPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.origin === CONSOLE_ORIGIN
      && url.pathname === '/api/console/orders'
      && url.searchParams.get('q') === token
      && !url.searchParams.has('cursor');
  });
  await page.getByLabel('Search Orders').fill(token);
  const page1Body = await (await firstPage).json() as { orders: ConsoleOrderResponse[]; nextCursor: string | null };
  expect(page1Body.orders).toHaveLength(25);
  expect(page1Body.nextCursor).toBeTruthy();
  const page1References = page1Body.orders.map((order) => order.reference);

  const page2Response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.origin === CONSOLE_ORIGIN
      && url.pathname === '/api/console/orders'
      && url.searchParams.get('q') === token
      && url.searchParams.get('cursor') === page1Body.nextCursor;
  });
  await page.getByRole('button', { name: 'Next' }).click();
  const page2Body = await (await page2Response).json() as { orders: ConsoleOrderResponse[]; nextCursor: string | null };
  expect(page2Body.orders).toHaveLength(25);
  const page2References = page2Body.orders.map((order) => order.reference);
  expect(page2References.some((reference) => page1References.includes(reference))).toBe(false);

  const page3Response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.origin === CONSOLE_ORIGIN
      && url.pathname === '/api/console/orders'
      && url.searchParams.get('q') === token
      && url.searchParams.get('cursor') === page2Body.nextCursor;
  });
  await page.getByRole('button', { name: 'Next' }).click();
  const page3Body = await (await page3Response).json() as { orders: ConsoleOrderResponse[]; nextCursor: string | null };
  expect(page3Body.orders).toHaveLength(1);
  const page3Reference = page3Body.orders[0].reference;
  expect(page1References.includes(page3Reference)).toBe(false);
  expect(page2References.includes(page3Reference)).toBe(false);

  await page.getByRole('link', { name: page3Reference }).click();
  await expect(page.getByRole('heading', { name: page3Reference })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: page3Reference })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: page3Reference })).toBeVisible();
  const restoredQuery = new URL(page.url());
  expect(restoredQuery.searchParams.get('q')).toBe(token);
  expect(restoredQuery.searchParams.get('cursor')).toBe(page2Body.nextCursor);

  const previousResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.origin === CONSOLE_ORIGIN
      && url.pathname === '/api/console/orders'
      && url.searchParams.get('q') === token
      && url.searchParams.get('cursor') === page1Body.nextCursor;
  });
  await page.getByRole('button', { name: 'Previous' }).click();
  const previousBody = await (await previousResponse).json() as { orders: ConsoleOrderResponse[] };
  expect(previousBody.orders.map((order) => order.reference)).toEqual(page2References);
  await expect(page.getByRole('link', { name: page2References[0] })).toBeVisible();
  await expect(page.getByRole('link', { name: page3Reference })).toHaveCount(0);
});
