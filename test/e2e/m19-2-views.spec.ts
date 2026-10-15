import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { confirmDialog, createDocument, openTool } from './helpers';

// The standard views and the panels off the view cube of M19.2 (Ú11, D8, revision U10) with OCCT
// in the browser, in Czech: the menu of the toolbar group "Zobrazit" offers the standard views
// (they are not buttons), and an open feature dialog starts under the view cube, so the cube stays
// clickable.

/** Overlay of the cube: 132 px square, 8 px from the top and the right edge of the canvas. */
const BOX = 132;
const MARGIN = 8;

/** The main canvas (the view cube draws into it too). */
function canvas(page: Page): Locator {
  return page.locator('canvas').first();
}

/** A screenshot of the canvas once two shots in a row are the same (fades and animations over). */
async function stableShot(page: Page): Promise<Buffer> {
  let previous = await canvas(page).screenshot();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await canvas(page).screenshot();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the canvas did not settle');
}

/** An item of the open menu by its label (the accessible name may go on with a shortcut). */
function menuItem(page: Page, label: string): Locator {
  return page.getByRole('menu').getByRole('menuitem', { name: new RegExp(`^${label}( |$)`) });
}

test.beforeEach(async ({ page }) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
});

test('the menu Zobrazit offers the standard views; Shora turns the view', async ({ page }) => {
  const nav = page.getByRole('navigation');
  // The standard views are not buttons of the bar.
  await expect(nav.getByLabel('Shora', { exact: true })).toHaveCount(0);

  await nav.getByRole('button', { name: 'Zobrazit', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toContainText([
    'Zobrazit vše',
    'Zepředu',
    'Zezadu',
    'Zprava',
    'Zleva',
    'Shora',
    'Zdola',
    'Izometrický',
  ]);

  const before = await stableShot(page);
  await menuItem(page, 'Shora').click();
  await expect(page.getByRole('menu')).toBeHidden();
  expect((await stableShot(page)).equals(before)).toBe(false);
});

test('with the extrude dialog open the centre of the view cube is clickable', async ({ page }) => {
  const dialog = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  const box = await canvas(page).boundingBox();
  const dialogBox = await dialog.boundingBox();
  if (box === null || dialogBox === null)
    throw new Error('the canvas or the dialog is not visible');
  // The dialog starts under the square of the cube.
  expect(dialogBox.y).toBeGreaterThanOrEqual(box.y + MARGIN + BOX);

  // A locator click fails when another element covers the point (Playwright checks the hit). The
  // hit target of the cube has no role nor name: it is the first child of the overlay.
  const before = await stableShot(page);
  await page.locator('.tc-view-cube > div').first().click({ timeout: 5000 });
  // The click on a face turns the view; the dialog stays open.
  expect((await stableShot(page)).equals(before)).toBe(false);
  await expect(dialog).toBeVisible();
});
