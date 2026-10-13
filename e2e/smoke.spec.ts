import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Smoke test of M10 (Ú11): the whole path click → operation → log → regeneration in the
// worker → rendering → undo, persistence across a reload, an invalid param and the read-only
// second tab. Runs against the production build (playwright.config.ts) in Czech.

/** From the document list to an open, empty document. */
async function createDocument(page: Page): Promise<void> {
  await page.goto('/');
  // Not exact: the name starts with the glyph of the icon font (the <i> is not aria-hidden).
  await page.getByRole('button', { name: 'Nový' }).click();
  await expect(page).toHaveURL(/#\/d\//);
  // The toolbar is there once the session is open.
  await expect(page.getByRole('button', { name: 'Kvádr', exact: true })).toBeEnabled();
}

/**
 * The input of a param field of the open dialog by its label. The input has no accessible
 * name of its own (FieldShell renders the label as a plain span), so the field is found
 * through its frame.
 */
function paramInput(page: Page, label: string): Locator {
  return page
    .getByRole('dialog')
    .locator('.param-field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .getByRole('textbox');
}

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

function timelineFeature(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
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
  // The tooltip of the item names its state and the issue.
  await expect(broken).toContainText('Chyba');
  await expect(broken).toContainText('Musí být větší než 0');
  await expect(timelineFeature(page, 'Kvádr 1')).not.toContainText('Chyba');

  await expect(page.getByText('Chyby: 1')).toBeVisible();
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
