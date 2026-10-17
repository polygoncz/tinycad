import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  delayUnaryCalls,
  historyRows,
  openTool,
  reloadWhenSaved,
  timelineFeature,
} from './helpers';

// The thin client (M52, ADR 0031) over a slow network: every unary call waits 150 ms. Outside the
// feature dialog nothing is shown ahead of the server (N168): the tree, the Browser and undo show
// the change with the read model of the answer. The tests wait for the final state, never for an
// intermediate one.

const DELAY_MS = 150;

test.beforeEach(async ({ page }) => {
  await delayUnaryCalls(page, DELAY_MS);
});

/** A box through its dialog, stored on the server. */
async function addBox(page: Page): Promise<void> {
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
}

/** Renames a feature of the Timeline through its context menu. */
async function renameInTimeline(page: Page, from: string, to: string): Promise<void> {
  await timelineFeature(page, from).click({ button: 'right' });
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Přejmenovat( |$)/ })
    .click();
  const field = page.getByRole('textbox', { name: 'Přejmenovat', exact: true });
  await field.fill(to);
  await field.press('Enter');
}

/** A row of the Browser by the name of its body. */
function browserBody(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

test('renaming a feature in the Timeline: the name comes with the answer and survives a reload', async ({
  page,
}) => {
  await createDocument(page);
  await addBox(page);
  const rows = await historyRows(page);
  await expect(rows).toHaveCount(1);

  await renameInTimeline(page, 'Kvádr 1', 'Základ');
  await expect(timelineFeature(page, 'Základ')).toBeVisible();
  await expect(rows).toHaveCount(2);

  await reloadWhenSaved(page);
  await expect(timelineFeature(page, 'Základ')).toBeVisible();
});

test('two quick Ctrl+Z after two changes undo both, without a toast (N169)', async ({ page }) => {
  await createDocument(page);
  await addBox(page);
  await renameInTimeline(page, 'Kvádr 1', 'Základ');
  await expect(timelineFeature(page, 'Základ')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();

  // The second Ctrl+Z goes before the read model of the first one is in.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');

  await expect(timelineFeature(page, 'Základ')).toHaveCount(0);
  await expect(timelineFeature(page, 'Kvádr 1')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  // A refused undo would be an error toast (role alert).
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the colour of a body in the Browser comes with the answer and survives a reload', async ({
  page,
}) => {
  await createDocument(page);
  await addBox(page);

  const color = page.getByLabel('Barva Těleso 1', { exact: true });
  await browserBody(page, 'Těleso 1').hover();
  await color.fill('#ff0000');
  await expect(color).toHaveValue('#ff0000');
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();

  await reloadWhenSaved(page);
  await expect(page.getByLabel('Barva Těleso 1', { exact: true })).toHaveValue('#ff0000');
});
