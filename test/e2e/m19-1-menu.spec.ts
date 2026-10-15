import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { confirmDialog, createDocument, openTool, timelineFeature } from './helpers';

// The context menus of M19.1 (Ú1, revision C1) with OCCT in the browser, in Czech. The menu is
// teleported to <body>: a parent with backdrop-filter (the Timeline, the Toolbar) no longer makes
// it a containing block of the fixed menu nor caps its stacking order. It is placed inside the
// window and works from the keyboard.

/** The box of a visible element; fails when it has none. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/**
 * An item of the menu by its label. The accessible name of an item goes on with its shortcut
 * ("Zobrazit vše F"), so the label is matched at the start.
 */
function menuItem(menu: Locator, label: string): Locator {
  return menu.getByRole('menuitem', { name: new RegExp(`^${label}( |$)`) });
}

/** The label of a toolbar group, which opens the menu of the group (its text, not aria-label). */
function groupLabel(page: Page, name: string): Locator {
  return page.getByRole('navigation').getByRole('button', { name, exact: true });
}

test('the timeline menu lies inside the window and Rename turns the row into a field', async ({
  page,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));

  // The Timeline is at the bottom of the window: the menu turns up, inside the window.
  await timelineFeature(page, 'Kvádr 1').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = await boxOf(menu);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport size');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.w).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.h).toBeLessThanOrEqual(viewport.height);

  // Rename: the menu closes and the row becomes the inline field, which keeps the focus.
  await menuItem(menu, 'Přejmenovat').click();
  await expect(menu).toBeHidden();
  const field = page.getByRole('textbox', { name: 'Přejmenovat', exact: true });
  await expect(field).toBeVisible();
  await field.fill('Základ');
  await field.press('Enter');
  await expect(timelineFeature(page, 'Základ')).toBeVisible();
  await expect(field).toBeHidden();
});

test('the toolbar menu opens above an open feature dialog', async ({ page }) => {
  // A narrower window brings the dialog on the right under the menu of the group "Zobrazit";
  // the whole toolbar still fits (revision C10 starts below ~950 px).
  await page.setViewportSize({ width: 1000, height: 720 });
  await createDocument(page);
  const dialog = await openTool(page, 'Kvádr', 'Kvádr 1');

  await groupLabel(page, 'Zobrazit').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // The menu overlaps the dialog, so the click below proves the stacking order.
  const m = await boxOf(menu);
  const d = await boxOf(dialog);
  expect(m.x < d.x + d.w && d.x < m.x + m.w && m.y < d.y + d.h && d.y < m.y + m.h).toBe(true);

  // Playwright clicks only an element that receives the pointer: the dialog must not cover it.
  await menuItem(menu, 'Zobrazit vše').click({ timeout: 5_000 });
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await confirmDialog(dialog);
});

test('the menu works from the keyboard', async ({ page }) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));

  // The feature menu: Edit, Rename, Suppress, Roll here (disabled: the bar is already there),
  // Delete. The first enabled item has the focus; the arrows skip the disabled one.
  await timelineFeature(page, 'Kvádr 1').click({ button: 'right' });
  const menu = page.getByRole('menu');
  const item = (label: string): Locator => menuItem(menu, label);
  await expect(item('Posunout bar sem')).toBeDisabled();
  await expect(item('Upravit featuru')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item('Přejmenovat')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item('Smazat')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(item('Potlačit')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item('Upravit featuru')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();

  // Esc closes only the menu, not the feature dialog under it, and the focus goes back to the
  // group label that opened the menu (from the keyboard, so WebKit focuses the button too).
  const dialog = await openTool(page, 'Kvádr', 'Kvádr 2');
  const label = groupLabel(page, 'Zobrazit');
  await label.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(item('Zobrazit vše')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(label).toBeFocused();
  await confirmDialog(dialog);
});
