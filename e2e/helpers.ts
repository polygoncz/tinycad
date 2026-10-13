import { expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Steps shared by the e2e scenarios. Elements are found only by their roles and accessible
// names (spec 11, "Přístupnost").

/** From the document list to an open, empty document. */
export async function createDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nový', exact: true }).click();
  await expect(page).toHaveURL(/#\/d\//);
  // The toolbar is there once the session is open.
  await expect(page.getByRole('button', { name: 'Kvádr', exact: true })).toBeEnabled();
}

/** The input of a param field of the open dialog, named by its label. */
export function paramInput(page: Page, label: string): Locator {
  return page.getByRole('dialog').getByRole('textbox', { name: label, exact: true });
}

/** Types the value into the param field and leaves it: the field reports its value on change. */
export async function fillParam(page: Page, label: string, value: string): Promise<void> {
  const input = paramInput(page, label);
  await input.fill(value);
  await input.press('Tab');
}

/** The item of the feature in the Timeline, named by the feature name. */
export function timelineFeature(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

/** Reloads the page once the log is in IndexedDB (the green dot of the title bar). */
export async function reloadWhenSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await page.reload();
}
