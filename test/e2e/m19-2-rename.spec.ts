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
// place and moves it to the top (newest change first). An empty name is never taken.

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

async function showDocuments(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty', exact: true })).toBeVisible();
}

test('a name renamed in the title bar survives a reload and undo does not bring it back', async ({
  page,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(titleName(page)).toHaveText('Bez názvu');

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
  await createDocument(page);

  await titleName(page).click();
  await nameField(page).fill('   ');
  await page.keyboard.press('Enter');
  await expect(titleName(page)).toHaveText('Bez názvu');

  await titleName(page).click();
  await nameField(page).fill('Zrušeno');
  await page.keyboard.press('Escape');
  await expect(nameField(page)).toHaveCount(0);
  await expect(titleName(page)).toHaveText('Bez názvu');
});

test('a card renamed in the list has the new name and comes first', async ({ page }) => {
  await createDocument(page);
  await titleName(page).click();
  await nameField(page).fill('Starší');
  // Leaving the field renames too.
  await page.getByRole('button', { name: 'Kvádr', exact: true }).focus();
  await expect(titleName(page)).toHaveText('Starší');
  await reloadWhenSaved(page);
  await showDocuments(page);
  await page.getByRole('button', { name: 'Nový', exact: true }).click();
  await expect(titleName(page)).toHaveText('Bez názvu');
  await showDocuments(page);

  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Bez názvu');

  const older = card(page, 'Starší');
  await older.hover();
  await older.getByRole('button', { name: 'Přejmenovat', exact: true }).click();
  await nameField(page).fill('Novější');
  await page.keyboard.press('Enter');

  await expect(card(page, 'Novější')).toHaveCount(1);
  await expect(card(page, 'Starší')).toHaveCount(0);
  await expect(cards.first()).toContainText('Novější');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an empty name in the list is refused with an error', async ({ page }) => {
  await createDocument(page);
  await showDocuments(page);

  const only = card(page, 'Bez názvu');
  await only.hover();
  await only.getByRole('button', { name: 'Přejmenovat', exact: true }).click();
  await nameField(page).fill('');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('Dokument se nepodařilo přejmenovat');
  await expect(card(page, 'Bez názvu')).toHaveCount(1);
});
