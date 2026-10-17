import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  openTool,
  reloadWhenSaved,
  timelineFeature,
} from './helpers';

// Renaming a document (M19.2, Ú12, D5) in the browser, in Czech: in the title bar the name is a
// button that turns into a text field; the new name survives a reload and Ctrl+Z (Cmd+Z) undoes
// the last modelling step, not the name. In the list Rename next to Delete renames the card in
// place and moves it to the top (newest change first). An empty name is never taken. The list
// holds the documents of the other workers too (N72): the tests look only at their own cards,
// named uniquely.

/** The name of the document in the title bar: a button named by its action. */
function titleName(page: Page): Locator {
  return page.getByRole('button', { name: 'Přejmenovat dokument', exact: true });
}

/** The text field of the name (title bar or card); one at a time. */
function nameField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Název dokumentu', exact: true });
}

/** The card of the document list with this name. */
function card(page: Page, name: string): Locator {
  return page.getByRole('article').filter({ has: page.getByText(name, { exact: true }) });
}

/** A name no other test uses. */
function uniqueName(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** The position of the card with this name in the list (newest change first); -1 = none. */
async function cardIndex(page: Page, name: string): Promise<number> {
  const names = await page.getByRole('article').allInnerTexts();
  return names.findIndex((text) => text.split('\n').some((line) => line.trim() === name));
}

async function showDocuments(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty', exact: true })).toBeVisible();
}

test('a name renamed in the title bar survives a reload and undo does not bring it back', async ({
  page,
}) => {
  const doc = await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(titleName(page)).toHaveText(doc.name);

  await titleName(page).click();
  const field = nameField(page);
  await expect(field).toBeFocused();
  // The whole text is selected: typing replaces it.
  await page.keyboard.type('Držák');
  await page.keyboard.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(titleName(page)).toHaveText('Držák');

  await reloadWhenSaved(page);
  await expect(titleName(page)).toHaveText('Držák');
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();

  // Undo goes past the rename to the box; the name stays.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(timelineFeature(page, 'Kvádr 1')).toHaveCount(0);
  await expect(titleName(page)).toHaveText('Držák');
});

test('an empty name or Esc in the title bar keeps the old name', async ({ page }) => {
  const doc = await createDocument(page);

  await titleName(page).click();
  await nameField(page).fill('   ');
  await page.keyboard.press('Enter');
  await expect(titleName(page)).toHaveText(doc.name);

  await titleName(page).click();
  await nameField(page).fill('Zrušeno');
  await page.keyboard.press('Escape');
  await expect(nameField(page)).toHaveCount(0);
  await expect(titleName(page)).toHaveText(doc.name);
});

test('a card renamed in the list has the new name and comes first', async ({ page }) => {
  const olderName = uniqueName('Starší');
  const newerName = uniqueName('Nový');
  const renamed = uniqueName('Novější');
  await createDocument(page);
  await titleName(page).click();
  await nameField(page).fill(olderName);
  // Leaving the field renames too.
  await page.getByRole('button', { name: 'Kvádr', exact: true }).focus();
  await expect(titleName(page)).toHaveText(olderName);
  await reloadWhenSaved(page);
  // A new document from the list gets the default name; renamed, so this test finds its card.
  await showDocuments(page);
  await page.getByRole('button', { name: 'Nový', exact: true }).click();
  await expect(titleName(page)).toHaveText('Bez názvu');
  await titleName(page).click();
  await nameField(page).fill(newerName);
  await page.keyboard.press('Enter');
  await expect(titleName(page)).toHaveText(newerName);
  await reloadWhenSaved(page);
  await showDocuments(page);

  // The newer document comes before the older one.
  await expect(card(page, olderName)).toHaveCount(1);
  await expect(card(page, newerName)).toHaveCount(1);
  expect(await cardIndex(page, newerName)).toBeLessThan(await cardIndex(page, olderName));

  const older = card(page, olderName);
  await older.hover();
  await older.getByRole('button', { name: 'Přejmenovat', exact: true }).click();
  await nameField(page).fill(renamed);
  await page.keyboard.press('Enter');

  await expect(card(page, renamed)).toHaveCount(1);
  await expect(card(page, olderName)).toHaveCount(0);
  await expect
    .poll(async () => (await cardIndex(page, renamed)) < (await cardIndex(page, newerName)))
    .toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an empty name in the list is refused with an error', async ({ page }) => {
  const doc = await createDocument(page);
  await showDocuments(page);

  const own = card(page, doc.name);
  await own.hover();
  await own.getByRole('button', { name: 'Přejmenovat', exact: true }).click();
  await nameField(page).fill('');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('Dokument se nepodařilo přejmenovat');
  await expect(card(page, doc.name)).toHaveCount(1);
});
