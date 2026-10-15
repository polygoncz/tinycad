import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { createDocument, fillParam, reloadWhenSaved, timelineFeature } from './helpers';

// The scenario of M11 (Ú8) with OCCT in the browser, in Czech: a box, a cylinder through it and
// a boolean subtract picked from the Browser; the result survives a reload, deleting the
// cylinder asks first and leaves the boolean with a translated unresolved reference, undo heals
// it, and a hidden body stays hidden after a reload.

/** The row of a body in the Browser, named by its displayed name. */
function browserBody(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

/** Toolbar → the dialog of the tool. */
async function openTool(page: Page, label: string): Promise<Locator> {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Box with the defaults (0..10 in every axis). */
async function addBox(page: Page): Promise<void> {
  await confirmDialog(await openTool(page, 'Kvádr'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
}

/** A cylinder along z through the middle of the box, longer than the box on both sides. */
async function addCylinder(page: Page): Promise<void> {
  const dialog = await openTool(page, 'Válec');
  // The options of the axis are translated (keys cylinder.axis.x… next to cylinder.axis).
  const axis = dialog.getByRole('combobox', { name: 'Osa', exact: true });
  await expect(axis).toHaveValue('z');
  await expect(axis.getByRole('option')).toHaveText(['X', 'Y', 'Z']);
  await fillParam(page, 'Střed podstavy X', '5');
  await fillParam(page, 'Střed podstavy Y', '5');
  await fillParam(page, 'Střed podstavy Z', '-1');
  await fillParam(page, 'Poloměr', '2');
  await fillParam(page, 'Výška', '12');
  await confirmDialog(dialog);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
}

/** Boolean subtract: target Těleso 1 (the box), tool Těleso 2 (the cylinder). */
async function addSubtract(page: Page): Promise<void> {
  const dialog = await openTool(page, 'Boolean');
  const op = dialog.getByRole('combobox', { name: 'Operace', exact: true });
  await expect(op.getByRole('option')).toHaveText(['Sjednocení', 'Rozdíl', 'Průnik']);
  // The first bodies field (Cíle) is active in a new dialog (R19).
  const targets = dialog.getByRole('button', { name: /^Cíle/ });
  const tools = dialog.getByRole('button', { name: /^Nástroje/ });
  await expect(targets).toHaveAttribute('aria-pressed', 'true');
  await browserBody(page, 'Těleso 1').click();
  await tools.click();
  await expect(tools).toHaveAttribute('aria-pressed', 'true');
  await browserBody(page, 'Těleso 2').click();
  // The chips name the picked bodies by their features.
  await expect(dialog.getByRole('button', { name: 'Odebrat Kvádr 1', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Odebrat Válec 1', exact: true })).toBeVisible();
  await op.selectOption({ label: 'Rozdíl' });
  await confirmDialog(dialog);
}

test('box, cylinder and a boolean subtract: reload, delete with confirm, undo', async ({
  page,
}) => {
  await createDocument(page);
  await addBox(page);
  await addCylinder(page);
  await addSubtract(page);

  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(timelineFeature(page, 'Boolean 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);

  await reloadWhenSaved(page);
  await expect(timelineFeature(page, 'Boolean 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);

  // Deleting the cylinder asks first (Playwright would dismiss the dialog otherwise).
  let question = '';
  page.once('dialog', (d) => {
    question = d.message();
    void d.accept();
  });
  await timelineFeature(page, 'Válec 1').click();
  await page.keyboard.press('Delete');
  await expect(timelineFeature(page, 'Válec 1')).toHaveCount(0);
  expect(question).toContain('1');

  await expect(page.getByText('Chyby: 1')).toBeVisible();
  const boolean = timelineFeature(page, 'Boolean 1');
  await expect(boolean).toHaveAccessibleDescription(/Odkazovaná položka neexistuje/);
  await expect(timelineFeature(page, 'Kvádr 1')).not.toHaveAccessibleDescription(/Chyba/);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(timelineFeature(page, 'Válec 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
});

test('a hidden body stays hidden after a reload', async ({ page }) => {
  await createDocument(page);
  await addBox(page);

  const row = browserBody(page, 'Těleso 1');
  await row.getByRole('button', { name: 'Skrýt', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Zobrazit', exact: true })).toBeVisible();

  await reloadWhenSaved(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(
    browserBody(page, 'Těleso 1').getByRole('button', { name: 'Zobrazit', exact: true }),
  ).toBeVisible();
});
