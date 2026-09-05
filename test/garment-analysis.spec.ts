import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';

// Render the real wizard in isolation so provider failures are deterministic.
const hbs = Handlebars.create();
for (const name of ['navbar', 'dock', 'maskEditor', 'frameEditor'])
  hbs.registerPartial(name, '');
hbs.registerHelper('t', (key: string) => key);
hbs.registerHelper('formatDate', () => '');
hbs.registerHelper('json', (value: unknown) => JSON.stringify(value));
hbs.registerHelper('ifInArray', function (_value, _array, options) {
  return options.inverse(this);
});
hbs.registerPartial(
  'colorMultiSelect',
  readFileSync(path.resolve('views/partials/colorMultiSelect.hbs'), 'utf8'),
);
const html = hbs.compile(
  readFileSync(path.resolve('views/wardrobe/form.hbs'), 'utf8'),
)({ colors: ['orange', 'blue'] });
const photo = {
  name: 'garment.png',
  mimeType: 'image/png',
  buffer: Buffer.from('test-photo'),
};

test.beforeEach(async ({ page }) => {
  await page.route('http://wardrobe.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<style>.hidden{display:none}</style>${html}`,
    }),
  );
  await page.goto('http://wardrobe.test/');
  await page.locator('#newGarmentPhoto').setInputFiles(photo);
});

test('failure remains visible and retry fills details without replacing manual edits', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/ai/garment-analysis', (route) => {
    calls++;
    return route.fulfill({
      json:
        calls === 1
          ? {
              available: true,
              status: 'error',
              message: 'Could not find garment details right now.',
            }
          : {
              available: true,
              status: 'success',
              name: 'Orange cap',
              category: 'accessories',
              brand: 'Example',
              colors: ['orange'],
            },
    });
  });
  await page.locator('#captureContinue').click();
  await expect(page.locator('#analysisStatus')).toBeVisible();
  await expect(page.locator('#analysisStatus')).toContainText('Could not');
  await expect(page.locator('#retryAnalysis')).toBeEnabled();
  await page.locator('input[name="name"]').fill('My favourite cap');
  await page.locator('#retryAnalysis').click();
  await expect(page.locator('input[name="brand"]')).toHaveValue('Example');
  await expect(page.locator('input[name="name"]')).toHaveValue(
    'My favourite cap',
  );
  await expect(
    page.locator('input[name="color"][value="orange"]'),
  ).toBeChecked();
  await page.locator('#wizardStepPhoto').click();
  await expect(page.locator('#captureContinue')).toBeEnabled();
  expect(calls).toBe(2);
});

test('HTTP errors offer retry and leave the form usable', async ({ page }) => {
  await page.route('**/ai/garment-analysis', (route) =>
    route.fulfill({ status: 413, body: 'Too large' }),
  );
  await page.locator('#captureContinue').click();
  await expect(page.locator('#analysisStatus')).toContainText('Could not');
  await expect(page.locator('#retryAnalysis')).toBeEnabled();
  await expect(page.locator('input[name="name"]')).toBeVisible();
});

test('new photos replace previous AI suggestions and clear an old brand', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/ai/garment-analysis', (route) =>
    route.fulfill({
      json:
        ++calls === 1
          ? {
              available: true,
              status: 'success',
              name: 'Orange cap',
              brand: 'Example',
              colors: ['orange'],
            }
          : {
              available: true,
              status: 'success',
              name: 'Blue shirt',
              colors: ['blue'],
            },
    }),
  );
  await page.locator('#captureContinue').click();
  await expect(page.locator('input[name="brand"]')).toHaveValue('Example');
  await page.locator('#wizardStepPhoto').click();
  await page
    .locator('#newGarmentPhoto')
    .setInputFiles({ ...photo, name: 'new.png' });
  await page.locator('#captureContinue').click();
  await expect(page.locator('input[name="name"]')).toHaveValue('Blue shirt');
  await expect(page.locator('input[name="brand"]')).toHaveValue('');
  await expect(
    page.locator('input[name="color"][value="orange"]'),
  ).not.toBeChecked();
  await expect(page.locator('input[name="color"][value="blue"]')).toBeChecked();
});
