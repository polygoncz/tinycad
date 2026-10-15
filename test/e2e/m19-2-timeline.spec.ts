import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { confirmDialog, createDocument, openTool, timelineFeature } from './helpers';

// The Timeline of M19.2 (Ú9; D9, D10, D14) with OCCT in the browser, in Czech: many features
// scroll behind edge buttons and never cover the status; the one tooltip of the Timeline lies in
// the window and gives way to the context menu; the items work from the keyboard.

/** The box of a visible element; fails when it has none. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** The box lies whole in the window. */
async function expectInWindow(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport size');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.w).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.h).toBeLessThanOrEqual(viewport.height);
}

/** Boxes "Kvádr 1" … "Kvádr n", each confirmed in its dialog. */
async function createBoxes(page: Page, n: number): Promise<void> {
  for (let i = 1; i <= n; i += 1)
    await confirmDialog(await openTool(page, 'Kvádr', `Kvádr ${String(i)}`));
  await expect(page.getByText(`Tělesa: ${String(n)}`)).toBeVisible();
}

/** The rollback bar of the Timeline, focusable from the keyboard (D14). */
function rollbackBar(page: Page): Locator {
  return page.getByRole('separator', { name: 'Rollback bar – táhněte', exact: true });
}

test('thirty features scroll behind the edge buttons and leave the status visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await createDocument(page);
  await createBoxes(page, 30);

  const toolbar = page.getByRole('toolbar', { name: 'Timeline', exact: true });
  const status = page.getByText('Tělesa: 30', { exact: true });
  const last = timelineFeature(page, 'Kvádr 30');
  const left = page.getByRole('button', { name: 'Posunout doleva', exact: true });
  const right = page.getByRole('button', { name: 'Posunout doprava', exact: true });

  // The status is whole in the window and right of the items.
  await expectInWindow(page, status);
  const items = await boxOf(toolbar);
  expect(items.x + items.w).toBeLessThanOrEqual((await boxOf(status)).x);

  // The wheel over the items scrolls them horizontally, back to the start (the last feature was
  // scrolled into view when its dialog opened).
  await toolbar.hover();
  await page.mouse.wheel(0, -10_000);
  // From the start "›" scrolls on until the last feature is in view; then only "‹" is left.
  await expect(right).toBeVisible();
  await expect(left).toBeHidden();
  for (let i = 0; i < 20 && (await right.isVisible()); i += 1) {
    await right.click();
    // The smooth scroll settles before the next click.
    await page.waitForTimeout(400);
  }
  await expect(right).toBeHidden();
  await expect(left).toBeVisible();
  const visible = await boxOf(toolbar);
  const lastBox = await boxOf(last);
  expect(lastBox.x).toBeGreaterThanOrEqual(visible.x - 1);
  expect(lastBox.x + lastBox.w).toBeLessThanOrEqual(visible.x + visible.w + 1);
  await expectInWindow(page, status);
});

test('the tooltip lies in the window and gives way to the context menu', async ({ page }) => {
  await createDocument(page);
  await createBoxes(page, 2);

  // The first item is at the left edge: centred, the tooltip would leave the window.
  const first = timelineFeature(page, 'Kvádr 1');
  await first.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Kvádr 1');
  await expectInWindow(page, tooltip);

  await first.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(tooltip).toBeHidden();
});

test('the items work from the keyboard', async ({ page, browserName }) => {
  await createDocument(page);
  await createBoxes(page, 3);
  // Safari (WebKit on macOS) tabs only between text fields by default; Option+Tab reaches all.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';

  // The bar is in the Tab order; ← moves it back by one feature, → forward again.
  const bar = rollbackBar(page);
  await bar.focus();
  await expect(bar).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveAttribute('aria-valuenow', '2');
  await expect(timelineFeature(page, 'Kvádr 3')).toHaveAccessibleDescription(/Za rollback barem/);
  await page.keyboard.press('ArrowRight');
  await expect(bar).toHaveAttribute('aria-valuenow', '3');

  // From the bar Tab goes into the items; Home and the arrows move the focus, the tooltip follows.
  await page.keyboard.press(tab);
  await page.keyboard.press('Home');
  await expect(timelineFeature(page, 'Kvádr 1')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const second = timelineFeature(page, 'Kvádr 2');
  await expect(second).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Kvádr 2');

  // Enter edits the feature, Esc closes the dialog.
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Kvádr 2', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Shift+F10 opens the context menu of the item; Esc closes it and the focus is back.
  await second.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(second).toBeFocused();
});
