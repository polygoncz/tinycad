import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  openTool,
  reloadWhenSaved,
  timelineFeature,
} from './helpers';

// Dragging the rollback bar in the Timeline (M19.1, Ú9, revision C2) with OCCT in the browser, in
// Czech. The bar is one element for the whole drag and listens on the window, so a drag over
// several features neither gets stuck halfway nor leaves the model where it was.

/** The rollback bar of the Timeline (it has no role; its tooltip names it). */
function rollbackBar(page: Page): Locator {
  return page.getByTitle('Rollback bar – táhněte', { exact: true });
}

/** The centre of a visible element in page px; fails when it has no box. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The feature is after the bar: its description carries the state (the item is grey). */
async function expectRolledBack(page: Page, name: string): Promise<void> {
  await expect(timelineFeature(page, name)).toHaveAccessibleDescription(/Za rollback barem/);
}

/** The feature is before the bar. */
async function expectActive(page: Page, name: string): Promise<void> {
  await expect(timelineFeature(page, name)).not.toHaveAccessibleDescription(/Za rollback barem/);
}

test('dragging the bar from the end before the second feature rolls back the last two', async ({
  page,
}) => {
  await createDocument(page);
  for (const name of ['Kvádr 1', 'Kvádr 2', 'Kvádr 3'])
    await confirmDialog(await openTool(page, 'Kvádr', name));
  const stepForward = page.getByRole('button', { name: 'O krok vpřed', exact: true });
  await expect(stepForward).toBeDisabled();

  // From the bar at the end over two features, to just left of the centre of the second one.
  // The pointer moves in small steps, so the bar passes the third feature on the way.
  const bar = await centreOf(rollbackBar(page));
  const second = await centreOf(timelineFeature(page, 'Kvádr 2'));
  await page.mouse.move(bar.x, bar.y);
  await page.mouse.down();
  await page.mouse.move(second.x - 6, bar.y, { steps: 20 });
  await page.mouse.up();

  await expectActive(page, 'Kvádr 1');
  await expectRolledBack(page, 'Kvádr 2');
  await expectRolledBack(page, 'Kvádr 3');
  await expect(stepForward).toBeEnabled();

  // The bar is in the document, not only in the view: the reload keeps it.
  await reloadWhenSaved(page);
  await expect(timelineFeature(page, 'Kvádr 3')).toBeVisible();
  await expectActive(page, 'Kvádr 1');
  await expectRolledBack(page, 'Kvádr 2');
  await expectRolledBack(page, 'Kvádr 3');
  await expect(stepForward).toBeEnabled();
});
