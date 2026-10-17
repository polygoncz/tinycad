import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  drawDimensionedRectangle,
  expectNoErrors,
  fillParam,
  isoCanvasOffset,
  openTool,
  paramInput,
  refField,
  timelineFeature,
} from './helpers';

// Visible errors of M19.1 (Ú13, revize U2, U3, U9) with OCCT in the browser, in Czech: a field
// keeps the line of its issue, so nothing below it jumps when the issue comes or goes; the block
// of errors under the fields shows what the fields cannot (a fillet the kernel could not make)
// and stays away while the issues at the fields say it all (a new feature without its input);
// the delete button of the document list is reachable from the keyboard. The states of the
// kernel and the store are not reachable from here; their texts are unit tests of ui.

/** The top edge of a visible element; fails when it has none. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return box.y;
}

/** The regeneration of the open dialog has run: the Timeline counts its error. */
async function expectFeatureErrors(page: Page, n: number): Promise<void> {
  await expect(page.getByText(`Chyby: ${String(n)}`)).toBeVisible();
}

/** A row of the Browser, named by its displayed text ("Oblast 1"). */
function browserRow(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

/** The default box: 10 × 10 × 10 mm at the origin; "Zobrazit vše" (F) fits the view on it. */
const BOX_MIN = [0, 0, 0] as const;
const BOX_MAX = [10, 10, 10] as const;
/** The middle of the top front edge (y = 0, z = 10): the iso view sees its front and top face. */
const TOP_FRONT_EDGE_MIDDLE = [5, 0, 10] as const;

test('a field issue that comes and goes does not move the fields below it', async ({ page }) => {
  await createDocument(page);
  const box = await openTool(page, 'Kvádr', 'Kvádr 1');
  const height = paramInput(page, 'Výška');
  const issue = box.getByText('Musí být větší než 0', { exact: true });
  const before = await topOf(height);

  await fillParam(page, 'Šířka', '0');
  await expect(issue).toBeVisible();
  expect(await topOf(height)).toBe(before);
  // The issue at the field says it all: no block of errors, even once the regeneration has run.
  await expectFeatureErrors(page, 1);
  await expect(box.getByRole('alert')).toHaveCount(0);

  await fillParam(page, 'Šířka', '10');
  await expect(issue).toHaveCount(0);
  expect(await topOf(height)).toBe(before);
  await confirmDialog(box);
  await expectNoErrors(page);
});

test('the region pick of a new extrude does not move the fields below', async ({ page }) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // A new extrude takes the only region by itself (M19.2 D6); removing it brings the issue.
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  const regions = refField(extrude, 'Oblasti');
  await expect(regions).toHaveText('Vybráno: 1 · vyberte v pohledu');
  const issue = extrude.getByText('Vyberte aspoň 1', { exact: true });
  const operation = extrude.getByRole('combobox', { name: 'Operace', exact: true });
  const before = await topOf(operation);
  await browserRow(page, 'Oblast 1').click();
  await expect(issue).toBeVisible();
  // Only a missing reference: a draft, no block of errors.
  await expect(timelineFeature(page, 'Vysunutí 1')).toHaveClass(/\bdraft\b/);
  await expect(extrude.getByRole('alert')).toHaveCount(0);
  expect(await topOf(operation)).toBe(before);

  // The pick takes the issue away (revize U9: the next field jumped up by a line).
  await browserRow(page, 'Oblast 1').click();
  await expect(regions).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await expect(issue).toHaveCount(0);
  expect(await topOf(operation)).toBe(before);
  await confirmDialog(extrude);
  await expectNoErrors(page);
});

test('the dialog shows the error of a fillet the kernel could not make', async ({ page }) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  // The camera of a new document stays put (M19.2 D7): fit it on the box for isoCanvasOffset.
  await page.keyboard.press('f');

  // A new fillet without edges: only the issue at the field, a draft (M19.2 D6).
  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  await expect(fillet.getByText('Vyberte aspoň 1', { exact: true })).toBeVisible();
  await expect(timelineFeature(page, 'Zaoblení 1')).toHaveClass(/\bdraft\b/);
  await expect(fillet.getByRole('alert')).toHaveCount(0);

  // An edge and a radius larger than the box: OCCT fails, the block says why (D6).
  const { dx, dy } = await isoCanvasOffset(page, BOX_MIN, BOX_MAX, TOP_FRONT_EDGE_MIDDLE);
  await clickCanvas(page, dx, dy);
  await expect(refField(fillet, 'Hrany')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await fillParam(page, 'Poloměr', '11');
  const errors = fillet.getByRole('alert');
  await expect(errors).toContainText(
    'Zaoblení se nepodařilo. Zkuste menší poloměr nebo jiné hrany.',
  );

  // A radius that fits: the block goes away once the fillet regenerates.
  await fillParam(page, 'Poloměr', '1');
  await expect(errors).toHaveCount(0);
  await confirmDialog(fillet);
  await expectNoErrors(page);
});

test('the delete button of a document is reachable from the keyboard', async ({
  page,
  browserName,
}) => {
  const doc = await createDocument(page);
  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  // Other workers have their documents in the list too (N72): the card of this test's one.
  const card = page.getByRole('article').filter({ has: page.getByText(doc.name, { exact: true }) });
  await expect(card).toHaveCount(1);
  const remove = card.getByRole('button', { name: 'Smazat dokument', exact: true });
  await expect(remove).toHaveCSS('opacity', '0');

  // From the card's open button, Tab goes on to the delete button, which shows itself. Safari
  // (WebKit on macOS) tabs only between text fields by default; Option+Tab reaches every control.
  await card.getByRole('button').first().focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '1');
});
