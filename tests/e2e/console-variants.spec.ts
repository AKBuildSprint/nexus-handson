import { expect, test, type Locator, type Page } from '@playwright/test';

function uniqueName(suffix: string): string {
  return `Verify Variant ${suffix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function fillRequiredProduct(page: Page, name: string) {
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Base price').fill('30.00');
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Product status').selectOption('Active');
  await page.getByLabel('Private access title').fill(`Download ${name}`);
  await page.getByLabel('Private access instructions').fill('Open the paid package.');
}

async function addGroup(page: Page, name: string, values: string[]): Promise<Locator> {
  await page.getByRole('button', { name: 'Add option group' }).click();
  const group = page.locator('section.option-group').last();
  await group.getByRole('textbox', { name: /Option group \d+/ }).fill(name);
  await group.getByRole('textbox', { name: 'Value 1' }).fill(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    await group.getByRole('button', { name: 'Add value' }).click();
    await group.getByRole('textbox', { name: `Value ${index + 1}` }).fill(values[index]);
  }
  return group;
}

async function expectCount(page: Page, count: number, copy: RegExp) {
  const meter = page.locator('.combination-meter');
  await expect(meter).toHaveAttribute('aria-label', new RegExp(`^${count} combinations\\.`));
  await expect(meter).toContainText(copy);
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.client).toBe(width);
  expect(dimensions.scroll).toBe(width);
  expect(dimensions.body).toBeLessThanOrEqual(width);
}

test('shows the reachable 10, 12, 30, and first 31+ Variant meter boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/console/products/new');
  await fillRequiredProduct(page, uniqueName('boundary-10'));
  await addGroup(page, 'Edition', Array.from({ length: 10 }, (_, index) => `Edition ${index + 1}`));
  await expectCount(page, 10, /Ready to generate/);
  await expect(page.getByRole('button', { name: 'Generate matrix' })).toBeEnabled();

  await page.reload();
  await fillRequiredProduct(page, uniqueName('boundary-12'));
  await addGroup(page, 'Theme', ['Light', 'Dark', 'System']);
  await addGroup(page, 'License', ['Solo', 'Team', 'Agency', 'Enterprise']);
  await expectCount(page, 12, /Confirmation required/);
  await expect(page.getByRole('button', { name: 'Generate matrix' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I reviewed this 12-combination matrix.' }).check();
  await page.getByRole('button', { name: 'Generate matrix' }).click();
  await expect(page.locator('.variant-table tbody tr')).toHaveCount(12);

  await page.reload();
  await fillRequiredProduct(page, uniqueName('boundary-30'));
  await addGroup(page, 'Format', Array.from({ length: 5 }, (_, index) => `Format ${index + 1}`));
  await addGroup(page, 'License', Array.from({ length: 6 }, (_, index) => `License ${index + 1}`));
  await expectCount(page, 30, /30 combinations is the maximum/);
  await page.getByRole('checkbox', { name: 'I reviewed this 30-combination matrix.' }).check();
  await expect(page.getByRole('button', { name: 'Generate matrix' })).toBeEnabled();

  await page.reload();
  await fillRequiredProduct(page, uniqueName('boundary-31-plus'));
  await addGroup(page, 'Format', Array.from({ length: 5 }, (_, index) => `Format ${index + 1}`));
  await addGroup(page, 'License', Array.from({ length: 7 }, (_, index) => `License ${index + 1}`));
  await expectCount(page, 35, /exceeds the 30-combination limit/);
  await expect(page.locator('.combination-meter')).toContainText('Blocked');
  await expect(page.getByRole('button', { name: 'Generate matrix' })).toBeDisabled();
});

test('persists Variant row edits, label-only rename, and retained/new/will-disable regeneration', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = uniqueName('lifecycle');
  await page.goto('/console/products/new');
  await fillRequiredProduct(page, name);
  await addGroup(page, 'Color', ['Red', 'Blue']);
  await addGroup(page, 'License', ['Solo', 'Team']);
  await expectCount(page, 4, /Ready to generate/);
  await page.getByRole('button', { name: 'Generate matrix' }).click();
  await expect(page.locator('.variant-table tbody tr')).toHaveCount(4);
  const skuStamp = Date.now();
  const rows = page.locator('.variant-table tbody tr');
  for (let index = 0; index < 4; index += 1) {
    await rows.nth(index).locator('input[id^="sku-"]').fill(`VERIFY-${skuStamp}-${index + 1}`);
  }

  const firstRow = rows.first();
  await firstRow.locator('input[id^="price-"]').fill('39.50');
  await firstRow.getByRole('checkbox').uncheck();
  const editDelivery = firstRow.getByRole('button', { name: /Edit delivery for/ });
  await editDelivery.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Use Variant override' }).check();
  await dialog.getByLabel('Private access title').fill('Variant package');
  await dialog.getByLabel('Private access instructions').fill('Open only this Variant package.');
  await dialog.getByRole('button', { name: 'Apply Variant changes' }).click();
  await expect(editDelivery).toBeFocused();
  await expect(firstRow).toContainText('Variant override');
  await expect(firstRow).toContainText('Override');
  await expect(firstRow).toContainText('Disabled');
  await page.locator('button.desktop-save').click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  await page.reload();
  await expect(page.locator('.variant-table tbody tr')).toHaveCount(4);
  await expect(page.locator('.variant-table tbody tr').filter({ has: page.locator(`input[value="VERIFY-${skuStamp}-1"]`) })).toContainText('Variant override');

  const savedColorGroup = page.locator('section.option-group').first();
  await savedColorGroup.getByRole('textbox', { name: 'Option group 1' }).fill('Palette');
  await savedColorGroup.getByRole('textbox', { name: 'Value 1' }).fill('Crimson');
  await expect(page.getByRole('button', { name: 'Preview regeneration' })).toHaveCount(0);
  await page.locator('button.desktop-save').click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Option group 1' })).toHaveValue('Palette');
  await expect(page.getByRole('textbox', { name: 'Value 1' }).first()).toHaveValue('Crimson');

  const reopenedColorGroup = page.locator('section.option-group').first();
  await reopenedColorGroup.getByRole('button', { name: /Remove value Crimson from Palette/ }).click();
  await reopenedColorGroup.getByRole('button', { name: 'Add value' }).click();
  await reopenedColorGroup.getByRole('textbox', { name: 'Value 2' }).fill('Green');
  await page.getByRole('button', { name: 'Preview regeneration' }).click();
  const preview = page.getByRole('heading', { name: 'Preview regeneration' }).locator('..').locator('..');
  await expect(preview.getByText('Retained', { exact: true }).first()).toBeVisible();
  await expect(preview.getByText('New', { exact: true }).first()).toBeVisible();
  await expect(preview.getByText('Will disable', { exact: true }).first()).toBeVisible();
  await preview.getByRole('button', { name: 'Regenerate matrix' }).click();
  await expect(page.getByRole('heading', { name: 'Preview regeneration' })).toHaveCount(0);
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(reopenedColorGroup.getByRole('textbox', { name: 'Value 2' })).toHaveValue('Green');
  await expect(page.locator('.variant-table tbody tr')).toHaveCount(4);
  await expectNoHorizontalOverflow(page, 1280);
});

test('uses the full-width 375px focused Variant editor with errors, Escape guard, overrides, and focus restoration', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/console/products/new');
  await fillRequiredProduct(page, uniqueName('mobile'));
  await addGroup(page, 'Edition', ['Standard', 'Extended']);
  await page.getByRole('button', { name: 'Generate matrix' }).click();
  const mobileStamp = Date.now();
  const cards = page.locator('.variant-summary-card');
  await cards.nth(0).getByRole('button', { name: /Edit Standard/ }).click();
  await page.getByRole('dialog').getByLabel('SKU').fill(`MOBILE-${mobileStamp}-1`);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply Variant changes' }).click();
  await cards.nth(1).getByRole('button', { name: /Edit Extended/ }).click();
  await page.getByRole('dialog').getByLabel('SKU').fill(`MOBILE-${mobileStamp}-2`);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply Variant changes' }).click();
  const card = cards.first();
  const editButton = card.getByRole('button', { name: /Edit Standard/ });
  await editButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeLessThanOrEqual(375);

  const sku = dialog.getByLabel('SKU');
  await sku.fill('');
  await sku.blur();
  await expect(dialog.getByText('SKU is required.').first()).toBeVisible();
  const savedSku = `MOBILE-${mobileStamp}-standard`;
  await sku.fill(savedSku);
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('Discard unsaved Variant changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay and continue editing' }).click();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Price override').fill('44.00');
  await dialog.getByRole('checkbox', { name: 'Enabled' }).uncheck();
  await dialog.getByRole('radio', { name: 'Use Variant override' }).check();
  await dialog.getByLabel('Private access title').fill('Mobile Variant package');
  await dialog.getByLabel('Private access instructions').fill('Open the mobile-focused package.');
  await dialog.getByRole('button', { name: 'Apply Variant changes' }).click();
  await expect(editButton).toBeFocused();
  await expect(card).toContainText('Override');
  await expect(card).toContainText('Variant override');
  await expect(card).toContainText('Disabled');

  await page.locator('.mobile-save-bar button[type="submit"]').click();
  await expect(page.getByText('The editor remains open so you can review the saved Product.')).toBeVisible();
  await page.reload();
  await expect(page.locator('.variant-summary-card').filter({ hasText: savedSku })).toContainText('Variant override');
  await expectNoHorizontalOverflow(page, 375);
});
