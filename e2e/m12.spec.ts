import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { createDocument, reloadWhenSaved, timelineFeature } from './helpers';

// The scenario of M12 (Ú15) with OCCT and planegcs in the browser, in Czech: a sketch on the
// XY plane, a rectangle snapped onto the origin, two dimensions make it fully defined, a new
// value of a dimension is solved again; Finish writes one entry, undo/redo and a reload keep
// the sketch, a double click opens it again and Cancel goes back to modelling.
//
// The canvas is clicked relative to its centre: an empty scene has the origin in the middle of
// the canvas once the camera looks along the normal of the sketch plane. Screen y grows down,
// so the rectangle (0, 0) → (120, −80) px lies in +x, +y of the plane.

/**
 * A tool or action button of the toolbar. The label of a group is a button with the same name
 * as a tool ("Skica"), and Finish / Cancel are in the sketch panel too; the tool buttons are
 * named by aria-label, the group labels by their text, so the label picks the tool.
 */
function toolbarButton(page: Page, name: string): Locator {
  return page.getByRole('navigation').getByLabel(name, { exact: true });
}

/** The panel of the open sketch, named by the sketch. */
function sketchPanel(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The value field of a dimension in the sketch panel, named by its row ("Vzdálenost 1"). */
function dimensionInput(panel: Locator, label: string): Locator {
  return panel.getByRole('textbox', { name: label, exact: true });
}

/** Clicks the canvas at (dx, dy) px from its centre. */
async function clickCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  // Move first, so the tool sees the hover (snap) before the press.
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

test('a fully defined rectangle sketch: dimensions, finish, undo, reload, edit', async ({
  page,
}) => {
  await createDocument(page);

  // 1. Into the sketch mode: the toolbar shows the sketcher, the panel is there.
  await toolbarButton(page, 'Skica').click();
  await expect(toolbarButton(page, 'Úsečka')).toBeVisible();
  await expect(toolbarButton(page, 'Obdélník')).toBeVisible();
  await expect(toolbarButton(page, 'Kvádr')).toHaveCount(0);
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const status = panel.getByRole('status');

  // 2. A rectangle from the origin (snap → fix): two degrees of freedom stay (width, height).
  await toolbarButton(page, 'Obdélník').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 120, -80);
  await expect(status).toHaveText('Stupně volnosti: 2');

  // 3. Dimensions of the bottom and the right edge → fully defined.
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, 60, 0);
  await clickCanvas(page, 120, -40);
  await expect(status).toHaveText('Plně určeno');
  const width = dimensionInput(panel, 'Vzdálenost 1');
  await expect(width).toBeVisible();
  await expect(dimensionInput(panel, 'Vzdálenost 2')).toBeVisible();

  // 4. A new value of the width is solved again and the sketch stays fully defined.
  const before = Number((await width.inputValue()).replace(',', '.'));
  expect(before).toBeGreaterThan(0);
  const doubled = String(before * 2);
  await width.fill(doubled);
  await width.press('Enter');
  await expect
    .poll(async () => Number((await width.inputValue()).replace(',', '.')))
    .toBeCloseTo(before * 2, 6);
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 5. Finish: the sketch is in the Timeline without an error, the toolbar models again.
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);
  await expect(toolbarButton(page, 'Kvádr')).toBeVisible();
  await expect(toolbarButton(page, 'Úsečka')).toHaveCount(0);

  // 6. Undo removes the whole sketch (one entry in the log), redo brings it back.
  await toolbarButton(page, 'Zpět').click();
  await expect(timelineFeature(page, 'Skica 1')).toHaveCount(0);
  await toolbarButton(page, 'Znovu').click();
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();

  await reloadWhenSaved(page);
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);

  // Editing the sketch again: fully defined after the first solve; Cancel goes back.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited.getByRole('status')).toHaveText('Plně určeno');
  await expect(toolbarButton(page, 'Kvádr')).toHaveCount(0);
  await edited.getByRole('button', { name: 'Zrušit skicu', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expect(toolbarButton(page, 'Kvádr')).toBeVisible();
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
});
