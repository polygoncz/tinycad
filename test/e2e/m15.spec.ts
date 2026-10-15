import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Download, Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  expectNoErrors,
  openTool,
  reloadWhenSaved,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenario of M15 (Ú10) with OCCT in the browser, in Czech: a box downloaded as STEP, the
// history panel with undo and redo rows, a body colour that survives a reload, and the document
// exported with its history and imported back as a new document where undo still works.

/** File menu of the title bar → the item; resolves with the download it starts. */
async function downloadFromFileMenu(page: Page, item: string): Promise<Download> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
  return downloading;
}

/**
 * The suggested name of a download in NFC: WebKit reports it decomposed (NFD, as the macOS file
 * system stores it), so "á" would not match the literal.
 */
function downloadName(download: Download): string {
  return download.suggestedFilename().normalize('NFC');
}

/** The text of a downloaded file. */
async function downloadedText(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8');
}

/** The rows of the history panel, newest first. */
function historyRows(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Historie úprav' }).getByRole('listitem');
}

test('download STEP, history panel, body colour, export and import of the document', async ({
  page,
}) => {
  await createDocument(page);

  // 1. A box → File → Export STEP: the file of the document name starts like STEP.
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  const step = await downloadFromFileMenu(page, 'Exportovat STEP');
  expect(downloadName(step)).toBe('Bez názvu.step');
  expect((await downloadedText(step)).startsWith('ISO-10303-21;')).toBe(true);

  // 2. A cylinder; the history panel lists both, newest first; undo adds its own row on top and
  // marks the cylinder entry undone; redo brings it back.
  await confirmDialog(await openTool(page, 'Válec', 'Válec 1'));
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Historie úprav', exact: true }).click();
  const rows = historyRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Válec');
  await expect(rows.nth(1)).toContainText('Kvádr');

  await toolbarButton(page, 'Zpět').click();
  await expect(timelineFeature(page, 'Válec 1')).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Zpět: Válec');
  await expect(rows.nth(1)).toHaveClass(/undone/);
  await expect(rows.nth(2)).not.toHaveClass(/undone/);
  await toolbarButton(page, 'Znovu').click();
  await expect(timelineFeature(page, 'Válec 1')).toBeVisible();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Znovu: Válec');

  // 3. The colour of the first body in the Browser; it survives a reload.
  const color = page.getByLabel('Barva Těleso 1', { exact: true });
  await color.fill('#ff0000');
  await expect(color).toHaveValue('#ff0000');
  await reloadWhenSaved(page);
  await expect(page.getByLabel('Barva Těleso 1', { exact: true })).toHaveValue('#ff0000');

  // 4. File → Export document → back to the documents → Import of the downloaded file: a new
  // document opens with the same features and the colour, and undo works there (the history came
  // along): the last entry is the colour, the one before it the cylinder.
  const exported = await downloadFromFileMenu(page, 'Exportovat dokument');
  expect(downloadName(exported)).toBe('Bez názvu.tinycad.json');
  const exportedPath = await exported.path();
  const sourceUrl = page.url();

  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importovat', exact: true }).click();
  await (await choosing).setFiles(exportedPath);

  await expect(page).toHaveURL(/#\/d\//);
  expect(page.url()).not.toBe(sourceUrl);
  for (const name of ['Kvádr 1', 'Válec 1']) {
    await expect(timelineFeature(page, name)).toBeVisible();
  }
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  const importedColor = page.getByLabel('Barva Těleso 1', { exact: true });
  await expect(importedColor).toHaveValue('#ff0000');
  await toolbarButton(page, 'Zpět').click();
  await expect(importedColor).not.toHaveValue('#ff0000');
  await expect(timelineFeature(page, 'Válec 1')).toBeVisible();
  await toolbarButton(page, 'Zpět').click();
  await expect(timelineFeature(page, 'Válec 1')).toHaveCount(0);
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  // 5. The console stays clean (fixtures).
});
