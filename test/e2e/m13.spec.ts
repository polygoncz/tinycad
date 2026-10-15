import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  dimensionInput,
  dimensionValue,
  drawDimensionedRectangle,
  expectNoErrors,
  fillParam,
  openTool,
  refField,
  reloadWhenSaved,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenario of M13 (Ú12) with OCCT and planegcs in the browser, in Czech: the dimensioned
// rectangle of M12 extruded into a body, a new dimension value regenerates it; a circle extruded
// with "Odebrat" makes a hole in a box; undo/redo and a reload keep the model; the rectangle
// revolved about the origin X axis is one more body. Regions and axes are picked in the Browser.

/**
 * A row of the Browser, named by its displayed text ("Těleso 1", "Oblast 1", "Osa X").
 * A body row is clicked on its name: the click hovers the row, which shows its colour and
 * material controls (spec 11), and the middle of the row may then fall on them; they keep the
 * click.
 */
function browserRow(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

test('extrude a rectangle, edit the sketch, cut a hole, undo, reload, revolve', async ({
  page,
}) => {
  await createDocument(page);

  // 1. The fully defined rectangle of M12 → Finish.
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // 2. Extrude: a new body, so "Sloučit s" is hidden; the region field is active and already
  // holds the only region of the sketch (M19.2 D6), the count stays visible (R87).
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  await expect(refField(extrude, 'Sloučit s')).toHaveCount(0);
  const regions = refField(extrude, 'Oblasti');
  await expect(regions).toHaveAttribute('aria-pressed', 'true');
  await expect(regions).toHaveText('Vybráno: 1 · vyberte v pohledu');
  const region = browserRow(page, 'Oblast 1');
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAttribute('aria-selected', 'true');
  await confirmDialog(extrude);
  await expect(timelineFeature(page, 'Vysunutí 1')).toBeVisible();
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(browserRow(page, 'Těleso 1')).toBeVisible();

  // 3. A new width in the sketch → Finish: the extrude follows without an error, one body still.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited.getByRole('status')).toHaveText('Plně určeno');
  const width = dimensionInput(edited, 'Vodorovná vzdálenost 1');
  const before = await dimensionValue(width);
  await width.fill(String(before * 2));
  await width.press('Enter');
  await expect.poll(async () => dimensionValue(width)).toBeCloseTo(before * 2, 6);
  await edited.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  // 4. A box around everything, centred on the origin in x and y: the camera of a new sketch is
  // fitted on the bodies, so the origin is again in the middle of the canvas and a circle there
  // lies inside the box. Then the circle extruded with "Odebrat" into the box.
  const box = await openTool(page, 'Kvádr', 'Kvádr 1');
  await fillParam(page, 'Počátek X', '-1000');
  await fillParam(page, 'Počátek Y', '-1000');
  await fillParam(page, 'Šířka', '2000');
  await fillParam(page, 'Hloubka', '2000');
  await confirmDialog(box);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();

  await toolbarButton(page, 'Skica').click();
  const circleSketch = sketchPanel(page, 'Skica 2');
  await expect(circleSketch).toBeVisible();
  await toolbarButton(page, 'Kružnice').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 40, 0);
  await circleSketch.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(circleSketch).toHaveCount(0);
  await expectNoErrors(page);

  const cut = await openTool(page, 'Vysunutí', 'Vysunutí 2');
  // The regions of both sketches are listed, those of Skica 2 after those of Skica 1; the only
  // region of the last sketch (the circle) is preselected (M19.2 D6).
  await expect(browserRow(page, 'Oblast 1').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(refField(cut, 'Oblasti')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await expect(refField(cut, 'Sloučit s')).toHaveCount(0);
  await cut.getByRole('combobox', { name: 'Operace', exact: true }).selectOption({
    label: 'Odebrat',
  });
  const targets = refField(cut, 'Sloučit s');
  await expect(targets).toBeVisible();
  await targets.click();
  await expect(targets).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Těleso 2').getByText('Těleso 2', { exact: true }).click();
  await expect(cut.getByRole('button', { name: 'Odebrat Kvádr 1', exact: true })).toBeVisible();
  await confirmDialog(cut);
  await expect(timelineFeature(page, 'Vysunutí 2')).toBeVisible();
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();

  // 5. Undo removes the whole extrude (one entry), redo brings it back; a reload keeps the model.
  await toolbarButton(page, 'Zpět').click();
  await expect(timelineFeature(page, 'Vysunutí 2')).toHaveCount(0);
  await toolbarButton(page, 'Znovu').click();
  await expect(timelineFeature(page, 'Vysunutí 2')).toBeVisible();

  await reloadWhenSaved(page);
  for (const name of ['Skica 1', 'Vysunutí 1', 'Kvádr 1', 'Skica 2', 'Vysunutí 2']) {
    await expect(timelineFeature(page, name)).toBeVisible();
  }
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await expectNoErrors(page);

  // 6. Revolve the rectangle about the origin X axis: its bottom edge lies on the axis, so the
  // profile does not cross it and the solid is valid.
  const revolve = await openTool(page, 'Rotace', 'Rotace 1');
  // The circle of the last sketch is preselected (M19.2 D6): swap it for the rectangle.
  await browserRow(page, 'Oblast 1').nth(1).click();
  await browserRow(page, 'Oblast 1').first().click();
  await expect(refField(revolve, 'Oblasti')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  const axis = refField(revolve, 'Osa');
  await expect(axis).toHaveText('Nevybráno');
  await axis.click();
  await expect(axis).toHaveAttribute('aria-pressed', 'true');
  // The origin folder is collapsed by default.
  await browserRow(page, 'Počátek').click();
  await browserRow(page, 'Osa X').click();
  await expect(axis).toHaveText('Osa X');
  await confirmDialog(revolve);
  await expect(timelineFeature(page, 'Rotace 1')).toBeVisible();
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 3')).toBeVisible();
  // 7. The console stays clean (fixtures).
});
