import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { createDocument, paramInput, timelineFeature } from './helpers';

// Smoke test of M10 (Ú11): the whole path click → operation → log → regeneration in the
// worker → rendering → undo, persistence across a reload, an invalid param and the read-only
// second tab. Runs against the production build (playwright.config.ts) in Czech. Elements are
// found only by their roles and accessible names (spec 11, "Přístupnost").

/** Toolbar Kvádr → height → OK. */
async function addBox(page: Page, height: string): Promise<void> {
  await page.getByRole('button', { name: 'Kvádr', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = paramInput(page, 'Výška');
  await input.fill(height);
  // The field reports its value on change (leaving the field).
  await input.press('Tab');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('box, undo, redo and reload keep the document and its body', async ({ page }) => {
  await createDocument(page);

  await addBox(page, '30');
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(timelineFeature(page, 'Kvádr 1')).toHaveCount(0);
  await expect(page.getByText('Tělesa: 0')).toBeVisible();

  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  // Reload only after the log is in IndexedDB (the green dot of the title bar).
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await page.reload();

  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  // The undo history is back too.
  await expect(page.getByRole('button', { name: 'Zpět', exact: true })).toBeEnabled();
});

test('height 0 marks the feature as an error and the other body stays', async ({ page }) => {
  await createDocument(page);

  await addBox(page, '30');
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  await addBox(page, '0');
  const broken = timelineFeature(page, 'Kvádr 2');
  await expect(broken).toBeVisible();
  // The description of the item names its state and the issue.
  await expect(broken).toHaveAccessibleDescription(/Chyba/);
  await expect(broken).toHaveAccessibleDescription(/Musí být větší než 0/);
  await expect(timelineFeature(page, 'Kvádr 1')).not.toHaveAccessibleDescription(/Chyba/);

  await expect(page.getByText('Chyby: 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
});

test('Enter in the dialog confirms it, the first field has the focus', async ({ page }) => {
  await createDocument(page);

  await page.getByRole('button', { name: 'Kvádr', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The first field of the box is the X of its origin.
  await expect(paramInput(page, 'Počátek X')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
});

test('a second tab with the same document is read-only', async ({ page, context }) => {
  await createDocument(page);
  await expect(page.getByText('Jen pro čtení')).toHaveCount(0);

  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByText('Jen pro čtení')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Kvádr', exact: true })).toBeDisabled();

  // The first tab keeps the lock.
  await expect(page.getByText('Jen pro čtení')).toHaveCount(0);
});
