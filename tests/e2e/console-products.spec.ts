import { type Page } from '@playwright/test';
import { expect, test } from '../support/console-auth-fixtures';

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: '375px', width: 375, height: 812 },
] as const;

function uniqueName(viewport: string): string {
  return `Verify ${viewport} Simple ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

function visibleSave(page: Page) {
  return page.locator('button.console-editor-save');
}

function discardGuard(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Discard unsaved Product changes?' }) });
}

async function fillRequiredProduct(page: Page, name: string) {
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Base price').fill('19.95');
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Product status').selectOption('Active');
  await page.getByLabel('Customer-visible description').fill(`Public ${name}`);
  await page.getByLabel('Private access title').fill(`Download ${name}`);
  await page.getByLabel('Private access instructions').fill('Open the private package from the paid order.');
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.clientWidth).toBe(width);
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

for (const viewport of viewports) {
  test(`creates, edits, lists, reopens, and deep-links a simple Product at ${viewport.name}`, async ({ consoleOwnerPage: page }) => {
    const name = uniqueName(viewport.name);
    const editedName = `${name} Edited`;
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/console/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

    const emptyQuery = `no-match-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await page.getByLabel('Search Products').fill(emptyQuery);
    await expect(page.getByRole('heading', { name: 'No Products match these filters.' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();

    await page.getByRole('button', { name: 'Add Product' }).first().click();
    await expect(page).toHaveURL('/console/products/new');
    await expect(page.getByText('New Product', { exact: true }).first()).toBeVisible();
    await fillRequiredProduct(page, name);
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await visibleSave(page).click();
    await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
    await expect(page).toHaveURL(/\/console\/products\/verify-/);
    const slugPath = new URL(page.url()).pathname;

    await page.reload();
    await expect(page.getByLabel('Product name')).toHaveValue(name);
    await expect(page.getByLabel('Base price')).toHaveValue('19.95');
    await page.getByLabel('Product name').fill(editedName);
    await page.getByLabel('Base price').fill('20.50');
    await visibleSave(page).click();
    await expect(page).toHaveURL(slugPath);
    await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();

    await page.getByRole('button', { name: 'Back to Products' }).click();
    await expect(page).toHaveURL('/console/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByLabel('Search Products').fill('');
    const productLink = page.getByRole('link', { name: editedName }).first();
    await expect(productLink).toBeVisible();
    await productLink.click();
    await expect(page).toHaveURL(slugPath);
    await expect(page.getByLabel('Product name')).toHaveValue(editedName);

    await page.goto(slugPath);
    await expect(page.getByLabel('Product name')).toHaveValue(editedName);
    await expect(page.getByLabel('Product status')).toHaveValue('Active');
    await expectNoHorizontalOverflow(page, viewport.width);
  });

  test(`keeps and discards dirty Product navigation and associates field errors at ${viewport.name}`, async ({ consoleOwnerPage: page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/console/products/new');
    const name = uniqueName(`${viewport.name}-dirty`);
    await fillRequiredProduct(page, name);
    await page.getByLabel('Base price').fill('-1.234');
    await page.getByLabel('Currency').fill('ZZZ');
    await page.getByLabel('Private access title').fill('');
    await page.getByLabel('Private access title').blur();
    await expect(page.locator('#delivery-access-title-error')).toHaveText('Private access title is required.');
    await expect(page.getByLabel('Private access title')).toHaveAttribute('aria-invalid', 'true');
    await expect(visibleSave(page)).toBeDisabled();

    await page.getByRole('button', { name: 'Back to Products' }).click();
    await expect(discardGuard(page)).toBeVisible();
    await discardGuard(page).getByRole('button', { name: 'Stay and continue editing' }).click();
    await expect(discardGuard(page)).toBeHidden();
    await expect(page).toHaveURL('/console/products/new');
    await expect(page.getByLabel('Product name')).toHaveValue(name);

    await page.getByRole('button', { name: 'Back to Products' }).click();
    await discardGuard(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL('/console/products');

    await page.getByRole('button', { name: 'Add Product' }).first().click();
    await page.getByLabel('Product name').fill(`${name} Browser History`);
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await expect(discardGuard(page)).toBeVisible();
    await discardGuard(page).getByRole('button', { name: 'Stay and continue editing' }).click();
    await expect(page).toHaveURL('/console/products/new');
    await expect(page.getByLabel('Product name')).toHaveValue(`${name} Browser History`);
    await page.goBack();
    await discardGuard(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL('/console/products');
    await expectNoHorizontalOverflow(page, viewport.width);
  });
}

test('restores focus to the opener and keeps Forward after dirty Back discard', async ({ consoleOwnerPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/console/products');
  const addProduct = page.getByRole('button', { name: 'Add Product' }).first();
  await addProduct.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Product name')).toBeFocused();

  // Clean close returns focus to the invoking control.
  await page.getByRole('button', { name: 'Back to Products' }).click();
  await expect(page).toHaveURL('/console/products');
  await expect(addProduct).toBeFocused();

  // Dirty Back → Discard returns to the list and keeps the editor on the
  // forward stack; Forward reopens the editor route.
  await addProduct.click();
  await page.getByLabel('Product name').fill('Forward restore check');
  await page.goBack();
  await expect(discardGuard(page)).toBeVisible();
  await discardGuard(page).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL('/console/products');
  await page.goForward();
  await expect(page).toHaveURL('/console/products/new');
  await expect(page.locator('dialog.console-editor-dialog[open]')).toBeVisible();
});

test('exposes skip navigation, focusable filters, and keyboard-visible Product controls', async ({ consoleOwnerPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/console/products');
  await page.locator('.console-nav').getByRole('button', { name: 'Products' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#console-content')).toBeFocused();

  await page.getByRole('tab', { name: 'All' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Draft' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Draft' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Archived' })).toBeFocused();

  const focusStyle = await page.getByRole('tab', { name: 'Archived' }).evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusStyle).not.toBe('none');
});
