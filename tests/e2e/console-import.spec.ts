import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { CSV_HEADER, CSV_HEADER_LINE, serializeCsvRow, type CsvRow } from '../../src/shared/csv-contract';

const fixtureDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/import');

function warningCsv(groups: Array<{ slug: string; themes: number; licenses: number }>): Buffer {
  const rows: CsvRow[] = [];
  for (const group of groups) {
    for (let theme = 1; theme <= group.themes; theme += 1) {
      for (let license = 1; license <= group.licenses; license += 1) {
        const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
        Object.assign(row, {
          product_slug: group.slug,
          product_name: group.slug,
          base_price: '12.00',
          currency: 'USD',
          product_status: 'active',
          access_title: 'Download',
          access_instructions: 'Open',
          variant_sku: `${group.slug.toUpperCase()}-${theme}-${license}`,
          variant_status: 'enabled',
          option_1_name: 'Theme',
          option_1_value: `Theme ${theme}`,
          option_2_name: 'License',
          option_2_value: `License ${license}`,
        });
        rows.push(row);
      }
    }
  }
  return Buffer.from(`${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`);
}

function simpleCsv(slug: string): Buffer {
  const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
  Object.assign(row, {
    product_slug: slug,
    product_name: slug,
    base_price: '7.00',
    currency: 'USD',
    product_status: 'active',
    access_title: 'Download',
    access_instructions: 'Open',
  });
  return Buffer.from(`${CSV_HEADER_LINE}\n${serializeCsvRow(row)}\n`);
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: '375px', width: 375, height: 812 },
]) {
  test(`downloads, previews, and imports through the real CSV API at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/console/products/import');
    await expect(page.getByRole('heading', { name: 'Import Products from CSV' })).toBeVisible();
    const fileInput = page.locator('#csv-file');
    await expect(fileInput).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download nexus-product-import-template.csv' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('nexus-product-import-template.csv');

    await fileInput.setInputFiles(path.join(fixtureDirectory, 'mixed-shapes.csv'));
    await expect(page.getByText('eligible-simple · Simple Product')).toBeVisible();
    await expect(page.getByText('mixed-shape · Variant Product')).toBeVisible();
    const importButton = page.getByRole('button', { name: 'Import Products' });
    await expect(importButton).toBeEnabled();
    await importButton.click();
    await expect(page.getByRole('heading', { name: 'Import result' })).toBeFocused();
    await expect(page.getByText('This authoritative result supersedes the browser preview')).toBeVisible();

    const documentWidth = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(documentWidth.clientWidth).toBe(viewport.width);

    expect(documentWidth.scrollWidth).toBe(documentWidth.clientWidth);
    expect(documentWidth.bodyScrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth);
  });
}
test('loads the complete unfiltered catalog identity set on a direct import route', async ({ page }) => {
  const catalogRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/console/products') catalogRequests.push(url.search);
  });
  await page.goto('/console/products/import');
  await expect(page.locator('#csv-file')).toBeEnabled();
  expect(catalogRequests).toContain('');
});

test('refreshes complete identities after success before unchanged reselect preview', async ({ page }) => {
  const slug = `refresh-candidate-${Date.now()}`;
  const file = { name: `${slug}.csv`, mimeType: 'text/csv', buffer: simpleCsv(slug) };
  let unfilteredCatalogRequests = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/console/products' && url.search === '') unfilteredCatalogRequests += 1;
  });
  await page.goto('/console/products/import');
  const fileInput = page.locator('#csv-file');
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles(file);
  await page.getByRole('button', { name: 'Import Products' }).click();
  await expect(page.getByRole('heading', { name: 'Import result' })).toBeFocused();
  const requestsBeforeRefresh = unfilteredCatalogRequests;

  await page.getByRole('button', { name: 'Start another import' }).click();
  await expect(page.getByText('Loading catalog identities')).toBeVisible();
  await expect(fileInput).toBeEnabled();
  expect(unfilteredCatalogRequests).toBeGreaterThan(requestsBeforeRefresh);
  await fileInput.setInputFiles(file);
  await expect(page.getByText('Duplicate candidate', { exact: true }).first()).toBeVisible();
});

test('lists every warning group under one confirmation and resets it when the file changes', async ({ page }) => {
  await page.goto('/console/products/import');
  const fileInput = page.locator('#csv-file');
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles({
    name: 'warning-a.csv',
    mimeType: 'text/csv',
    buffer: warningCsv([
      { slug: 'warning-twelve', themes: 2, licenses: 6 },
      { slug: 'warning-thirty', themes: 5, licenses: 6 },
    ]),
  });
  await expect(page.getByText('2 Product groups require confirmation.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'warning-twelve' }).getByText('12 combinations')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'warning-thirty' }).getByText('30 combinations')).toBeVisible();
  const confirmation = page.getByRole('checkbox', { name: 'I reviewed every Product group with 11 to 30 combinations.' });
  await expect(confirmation).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Import Products' })).toBeDisabled();
  await confirmation.check();
  await expect(page.getByRole('button', { name: 'Import Products' })).toBeEnabled();

  await fileInput.setInputFiles({
    name: 'warning-b.csv',
    mimeType: 'text/csv',
    buffer: warningCsv([{ slug: 'warning-reset', themes: 2, licenses: 6 }]),
  });
  await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Import Products' })).toBeDisabled();
});

test('retains a committed malformed result without exposing a re-POST action', async ({ page }) => {
  let postCount = 0;
  await page.route('**/api/console/imports', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    postCount += 1;
    const committedResponse = await route.fetch();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });
    await route.fulfill({
      response: committedResponse,
      contentType: 'application/json',
      body: JSON.stringify({ committed: true, result: 'schema-invalid' }),
    });
  });
  await page.goto('/console/products/import');
  const fileInput = page.locator('#csv-file');
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles(path.join(fixtureDirectory, 'unified-template.csv'));
  await page.getByRole('button', { name: 'Import Products' }).click();
  await expect(page.getByText('Uploading CSV', { exact: true }).first()).toBeVisible();
  await expect(fileInput).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Import result could not be displayed' })).toBeFocused();
  await expect(page.locator('[data-state="CI-RESULT-ERROR"]')).toBeVisible();
  await expect(page.getByText('No authoritative counts are shown.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Import' })).toHaveCount(0);
  expect(postCount).toBe(1);

  await page.getByRole('button', { name: 'Start another import' }).click();
  await expect(page.getByRole('heading', { name: 'Browser preview' })).toBeVisible();
  expect(postCount).toBe(1);
});
