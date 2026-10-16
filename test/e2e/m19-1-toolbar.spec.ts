import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { createDocument, sketchPanel, toolbarButton } from './helpers';

// The overflow of the toolbar of M19.1 (Ú10, revision C10) with OCCT in the browser, in Czech:
// the groups that do not fit into a narrow window are not in the bar, the button "…" ("Další
// nástroje") offers their items in a menu, with the same label, shortcut, state and command as
// the buttons. In a wide window there is no "…". Both modes: the sketcher has more buttons.

/**
 * The narrow window of the sketcher (px): since M31 (Drážka ▾, Bod, Konstrukční) the group
 * Kreslit is about 430 px wide and does not fit into 700 px next to Historie and Výběr.
 */
const SKETCH_NARROW = 800;

/** The button "…" of the toolbar. */
function moreButton(page: Page): Locator {
  return page.getByRole('navigation').getByRole('button', { name: 'Další nástroje', exact: true });
}

/** The label of a toolbar group, which opens the menu of the group (its text, not aria-label). */
function groupLabel(page: Page, name: string): Locator {
  return page.getByRole('navigation').getByRole('button', { name, exact: true });
}

/**
 * An item of the menu by its label. The accessible name of an item goes on with its shortcut
 * ("Zobrazit vše F"), so the label is matched at the start.
 */
function menuItem(menu: Locator, label: string): Locator {
  return menu.getByRole('menuitem', { name: new RegExp(`^${label}( |$)`) });
}

/** The menu lies inside the window. */
async function expectInsideWindow(page: Page, menu: Locator): Promise<void> {
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('no box of the menu or the window');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('at 700 px the group Výběr runs from the menu "…", at 1400 px there is no "…"', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await createDocument(page);

  // Neither the label nor the tool of the group Výběr is in the bar; the button "…" is.
  const more = moreButton(page);
  await expect(more).toBeVisible();
  await expect(groupLabel(page, 'Výběr')).toBeHidden();
  await expect(toolbarButton(page, 'Vybrat')).toBeHidden();
  await expect(toolbarButton(page, 'Skica')).toBeVisible();

  // The menu: the items of the groups out of the bar, group after group (Zobrazit, then Výběr),
  // each with the shortcut of its button.
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectInsideWindow(page, menu);
  await expect(menu.getByRole('menuitem')).toContainText(['Zobrazit vše', 'Vybrat']);
  await expect(menuItem(menu, 'Zobrazit vše')).toHaveText(/^Zobrazit vše\s*F$/);
  await expect(menuItem(menu, 'Vybrat')).toBeEnabled();

  await menuItem(menu, 'Vybrat').click();
  await expect(menu).toBeHidden();

  // A wide window: everything fits, no "…".
  await page.setViewportSize({ width: 1400, height: 720 });
  await expect(toolbarButton(page, 'Vybrat')).toBeVisible();
  await expect(groupLabel(page, 'Výběr')).toBeVisible();
  await expect(more).toBeHidden();
});

test('the sketcher overflows too: the menu "…" has the same states and runs the actions', async ({
  page,
}) => {
  // 800 px: the group Kreslit (wider since M31) still fits, the constraints and Finish do not.
  await page.setViewportSize({ width: SKETCH_NARROW, height: 720 });
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await expect(toolbarButton(page, 'Úsečka')).toBeVisible();

  // The constraints and Finish do not fit: they are in the menu, disabled as their buttons are
  // without a selection.
  const more = moreButton(page);
  await expect(more).toBeVisible();
  await expect(toolbarButton(page, 'Vodorovná')).toBeHidden();
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectInsideWindow(page, menu);
  await expect(menuItem(menu, 'Kóta')).toBeEnabled();
  await expect(menuItem(menu, 'Vodorovná')).toBeDisabled();
  await expect(menuItem(menu, 'Zrušit skicu')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(panel).toBeVisible();

  // A wide window: the same states on the buttons, no "…". Since M31 and M36 the sketcher needs
  // about 1450 px; at 1280 px only Dokončit and Zobrazit go to the menu (spec 11).
  await page.setViewportSize({ width: 1600, height: 720 });
  await expect(more).toBeHidden();
  await expect(toolbarButton(page, 'Kóta')).toBeEnabled();
  await expect(toolbarButton(page, 'Vodorovná')).toBeVisible();
  await expect(toolbarButton(page, 'Vodorovná')).toBeDisabled();

  // Narrow again: Zrušit skicu from the menu ends the sketch, the bar models again.
  await page.setViewportSize({ width: SKETCH_NARROW, height: 720 });
  await more.click();
  await menuItem(menu, 'Zrušit skicu').click();
  await expect(menu).toBeHidden();
  await expect(panel).toHaveCount(0);
  await expect(toolbarButton(page, 'Úsečka')).toHaveCount(0);
  await expect(toolbarButton(page, 'Skica')).toBeVisible();
});
