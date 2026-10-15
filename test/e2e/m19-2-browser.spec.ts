import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { confirmDialog, createDocument, openTool } from './helpers';

// The tree of the Browser from the keyboard (M19.2, Ú10, D14, revision U3), in Czech: the ARIA
// pattern tree with aria-level, a roving tabindex and the keys of treeKey.

/** A row of the Browser tree, named by its text. */
function treeRow(page: Page, name: string) {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

test('the tree goes from the keyboard: Tab, arrows, Enter renames a body, Escape', async ({
  page,
  browserName,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));

  const tree = page.getByRole('tree', { name: 'Prohlížeč', exact: true });
  await expect(tree).toBeVisible();
  const bodies = treeRow(page, 'Tělesa');
  const body = treeRow(page, 'Těleso 1');
  await expect(bodies).toHaveAttribute('aria-level', '2');
  await expect(body).toHaveAttribute('aria-level', '3');
  await expect(bodies).toHaveAttribute('aria-expanded', 'true');

  // From the header of the panel into the tree: the first row is the only one in the tab order.
  // Safari (WebKit on macOS) tabs only between text fields by default; Option+Tab reaches every
  // control.
  await page.getByRole('button', { name: 'Prohlížeč', exact: true }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const root = tree.getByRole('treeitem').first();
  await expect(root).toBeFocused();
  await expect(root).toHaveAttribute('aria-level', '1');

  // Document › Origin › Sketches › Bodies.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(bodies).toBeFocused();
  await expect(bodies).toHaveAttribute('tabindex', '0');
  await expect(root).toHaveAttribute('tabindex', '-1');

  // ← closes the open folder, → opens it again and then goes to its first child.
  await page.keyboard.press('ArrowLeft');
  await expect(bodies).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(bodies).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(body).toBeFocused();

  // Enter on a body opens the inline field; Escape cancels it and the focus is back on the row.
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: 'Přejmenovat těleso', exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(body).toBeFocused();
  await expect(body).toContainText('Těleso 1');
});
