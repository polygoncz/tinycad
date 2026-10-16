import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  constraintSection,
  createDocument,
  openConstraintSection,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The snapper and the automatic constraints of M26 (spec 12, "Snapper a auto-vazby (M26)") with
// planegcs in the browser, in Czech: a rectangle drawn onto the edge of another one shares its
// points and adds no redundant constraint; a line drawn almost perpendicular to the previous line
// of a polyline gets "Kolmost", with Ctrl/Cmd it does not; a line started on an existing line gets
// "Bod na křivce", which holds while the end of that line is dragged; a drawing tool over a line
// shows the preview glyph of the constraint it would add. The grid snap is switched off, so the
// clicks land where they are (the inference tolerances are pixels, the grid would round them).

/** Into a new sketch with the grid snap off and the constraint list open; returns the panel of the sketch. */
async function openSketchWithoutGrid(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  // The list of the constraints is opened before drawing: a click into the panel takes the focus
  // from the view, whose keys (Escape of the tools) need it until the next click on the canvas.
  await openConstraintSection(panel);
  return panel;
}

/** The rows of the constraint list of the panel (opened by openSketchWithoutGrid). */
function constraintRows(panel: Locator): Locator {
  return constraintSection(panel).getByRole('listitem');
}

/** The name button of a constraint row ("Kolmost 1"). */
function constraintRow(panel: Locator, name: string): Locator {
  return constraintSection(panel).getByRole('button', { name, exact: true });
}

/** Moves the pointer onto the canvas at (dx, dy) px from its centre, without a click. */
async function moveOverCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Drags with the left button from (fromX, fromY) to (toX, toY) px from the canvas centre. */
async function dragOnCanvas(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + from[0], cy + from[1]);
  await page.mouse.down();
  await page.mouse.move(cx + to[0], cy + to[1], { steps: 10 });
  await page.mouse.up();
}

/** The icons of the inference preview over the view (aria-hidden, so found by their class). */
function previewGlyphs(page: Page): Locator {
  return page.locator('.sketch-glyphs .preview');
}

test('a rectangle on the edge of another one shares its points, no redundant constraint', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A rectangle away from the origin: four points (8) minus two horizontal and two vertical.
  await toolbarButton(page, 'Obdélník rohy').click();
  await clickCanvas(page, -160, 60);
  await clickCanvas(page, -40, -40);
  await expect(status).toHaveText('Stupně volnosti: 4');

  // 2. A second rectangle from the corner (−40, 60) px to (80, −40) px: its left edge is the
  // right edge of the first one (the clicked corner and the computed corner (−40, −40) px are
  // existing points, the edge between them exists). Two new points (4) minus the three new
  // edges' horizontal / vertical: the shared edge keeps its one vertical.
  await clickCanvas(page, -40, 60);
  await clickCanvas(page, 80, -40);
  await expect(status).toHaveText('Stupně volnosti: 5');

  // 3. Seven constraints, none redundant: no message in the panel.
  await expect(constraintRows(panel)).toHaveCount(7);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a line almost perpendicular to the previous one gets Kolmost', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A slanted line (no axis): two free points.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, 100, -40);
  await expect(status).toHaveText('Stupně volnosti: 4');

  // 2. The next line of the polyline ~1° off the perpendicular (−50, −100) px, 26° off the
  // vertical: one new point (2) minus the perpendicular.
  await clickCanvas(page, 52, -140);
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(constraintRows(panel)).toHaveCount(1);
  await expect(constraintRow(panel, 'Kolmost 1')).toBeVisible();
});

test('with Ctrl/Cmd the almost perpendicular line gets no constraint', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, 100, -40);
  await expect(status).toHaveText('Stupně volnosti: 4');

  // The same second line with Ctrl (Cmd on a Mac, KeyMods.mod) held: no inference, two more
  // degrees of freedom, no constraint; the preview shows nothing.
  await page.keyboard.down('ControlOrMeta');
  await moveOverCanvas(page, 52, -140);
  await expect(previewGlyphs(page)).toHaveCount(0);
  await clickCanvas(page, 52, -140);
  await page.keyboard.up('ControlOrMeta');
  await expect(status).toHaveText('Stupně volnosti: 6');
  await expect(constraintRows(panel)).toHaveCount(0);
});

test('a point on a line gets Bod na křivce and stays on it when the line is dragged', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A slanted line (−100, 60) → (100, −40) px; Escape ends the chain.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, 100, -40);
  await expect(status).toHaveText('Stupně volnosti: 4');
  await page.keyboard.press('Escape');

  // 2. The pointer over the line, a quarter from its start (not its middle), shows the preview
  // glyph of the point on the curve; off the line there is none.
  await moveOverCanvas(page, -50, 35);
  await expect(previewGlyphs(page)).toHaveCount(1);
  await moveOverCanvas(page, -150, -140);
  await expect(previewGlyphs(page)).toHaveCount(0);

  // 3. A new line started there: its first point gets the point on the curve. Two new points (4)
  // minus the point on the curve.
  await clickCanvas(page, -50, 35);
  await clickCanvas(page, -150, -120);
  await expect(status).toHaveText('Stupně volnosti: 7');
  await expect(constraintRows(panel)).toHaveCount(1);
  await expect(constraintRow(panel, 'Bod na křivce 1')).toBeVisible();

  // 4. The select tool drags the end (100, −40) px of the first line to (100, −100) px: the
  // solver keeps the point on it, the constraint stays, no conflict, the same degrees of freedom.
  // That the line moved shows the line tool: (50, −15) px, three quarters along the old line, is
  // on the curve before the drag and off it after.
  await page.keyboard.press('Escape');
  await moveOverCanvas(page, 50, -15);
  await expect(previewGlyphs(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await dragOnCanvas(page, [100, -40], [100, -100]);
  await expect(status).toHaveText('Stupně volnosti: 7');
  await expect(constraintRow(panel, 'Bod na křivce 1')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await toolbarButton(page, 'Úsečka').click();
  await moveOverCanvas(page, 50, -15);
  await expect(previewGlyphs(page)).toHaveCount(0);
});
