import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: '375px', width: 375, height: 812 },
] as const;

function uniqueName(viewport: string): string {
  return `Verify ${viewport} Simple ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

function visibleSave(page: Page, width: number) {
  return width < 720
    ? page.locator('.mobile-save-bar button[type="submit"]')
    : page.locator('button.desktop-save');
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
  test(`creates, edits, lists, reopens, and deep-links a simple Product at ${viewport.name}`, async ({ page }) => {
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
    await visibleSave(page, viewport.width).click();
    await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
    await expect(page).toHaveURL(/\/console\/products\/verify-/);
    const slugPath = new URL(page.url()).pathname;

    await page.reload();
    await expect(page.getByLabel('Product name')).toHaveValue(name);
    await expect(page.getByLabel('Base price')).toHaveValue('19.95');
    await page.getByLabel('Product name').fill(editedName);
    await page.getByLabel('Base price').fill('20.50');
    await visibleSave(page, viewport.width).click();
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

  test(`keeps and discards dirty Product navigation and associates field errors at ${viewport.name}`, async ({ page }) => {
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
    await expect(visibleSave(page, viewport.width)).toBeDisabled();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Discard unsaved Product changes?');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Back to Products' }).click();
    await expect(page).toHaveURL('/console/products/new');
    await expect(page.getByLabel('Product name')).toHaveValue(name);

    page.once('dialog', async (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Back to Products' }).click();
    await expect(page).toHaveURL('/console/products');

    await page.getByRole('button', { name: 'Add Product' }).first().click();
    await page.getByLabel('Product name').fill(`${name} Browser History`);
    page.once('dialog', async (dialog) => dialog.dismiss());
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await expect(page).toHaveURL('/console/products/new');
    await expect(page.getByLabel('Product name')).toHaveValue(`${name} Browser History`);
    page.once('dialog', async (dialog) => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL('/console/products');
    await expectNoHorizontalOverflow(page, viewport.width);
  });
}

test('exposes skip navigation, focusable filters, and keyboard-visible Product controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/console/products');
  await page.keyboard.press('Tab');
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
