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

// The arcs and circles of M27 (spec 12, "Oblouky a kružnice (M27)") with planegcs in the browser,
// in Czech: the split button Kružnice ▾ offers the variants of the family and shows the chosen
// one; a 3-point circle is drawn without a message, three points on a line draw nothing and keep
// the tool; a circle tangent to two lines gets two "Tečnost"; a drag from the last point of a
// polyline draws a tangent arc and the polyline goes on with a line. The grid snap is switched
// off, so the clicks land where they are.

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

/** The arrow ▾ of the split button of a tool family, named by the shown variant. */
function variantsButton(page: Page, shown: string): Locator {
  return page
    .getByRole('navigation')
    .getByRole('button', { name: `Další způsoby: ${shown}`, exact: true });
}

/** Opens the menu of the variants by the arrow of the family showing `shown` and picks `variant`. */
async function pickVariant(page: Page, shown: string, variant: string): Promise<void> {
  await variantsButton(page, shown).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: new RegExp(`^${variant}( |$)`) }).click();
  await expect(menu).toBeHidden();
}

/** The name buttons of the constraint rows of a kind ("Tečnost 1", "Tečnost 2" …). */
function constraintRowsOf(panel: Locator, kind: string): Locator {
  return constraintSection(panel).getByRole('button', { name: new RegExp(`^${kind} \\d+$`) });
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

test('the split button Kružnice ▾ opens the variants and shows the chosen one', async ({
  page,
}) => {
  await openSketchWithoutGrid(page);

  // At first the family shows its first tool, the arrow is named by it.
  await expect(toolbarButton(page, 'Kružnice')).toBeVisible();
  const arrow = variantsButton(page, 'Kružnice');
  await expect(arrow).toHaveAttribute('aria-haspopup', 'menu');

  // The arrow opens the menu with all the circle tools in the order of registration.
  await arrow.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toContainText([
    'Kružnice',
    'Kružnice 2 body',
    'Kružnice 3 body',
    'Kružnice 2 tečny',
    'Kružnice 3 tečny',
  ]);

  // Picking a variant activates it and the button shows it from now on.
  await menu.getByRole('menuitem', { name: /^Kružnice 3 body( |$)/ }).click();
  await expect(menu).toBeHidden();
  await expect(toolbarButton(page, 'Kružnice 3 body')).toBeVisible();
  await expect(toolbarButton(page, 'Kružnice 3 body')).toHaveClass(/active/);
  await expect(toolbarButton(page, 'Kružnice')).toHaveCount(0);
  await expect(variantsButton(page, 'Kružnice 3 body')).toBeVisible();
});

test('a 3-point circle is drawn without a message', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  await pickVariant(page, 'Kružnice', 'Kružnice 3 body');
  await clickCanvas(page, -100, 40);
  await clickCanvas(page, 20, -80);
  await clickCanvas(page, 120, 30);

  // A free circle: the centre (2) and the radius (1); no constraint, no message.
  await expect(status).toHaveText('Stupně volnosti: 3');
  await expect(constraintSection(panel).getByRole('listitem')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('three points on a line draw no circle and the tool stays active', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');
  await expect(status).toHaveText('Plně určeno');

  await pickVariant(page, 'Kružnice', 'Kružnice 3 body');
  await clickCanvas(page, -120, 60);
  await clickCanvas(page, -20, 10);
  await clickCanvas(page, 80, -40);

  // Nothing is drawn, the tool stays active with its two points.
  await expect(status).toHaveText('Plně určeno');
  await expect(toolbarButton(page, 'Kružnice 3 body')).toHaveClass(/active/);

  // A third point off the line draws the circle through the first two.
  await clickCanvas(page, 40, 80);
  await expect(status).toHaveText('Stupně volnosti: 3');
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a circle tangent to two lines gets two Tečnost', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // Two slanted lines, not parallel, their ends not aligned (no inference); Escape ends each
  // chain.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -150, 100);
  await clickCanvas(page, 150, 40);
  await page.keyboard.press('Escape');
  await clickCanvas(page, -130, -110);
  await clickCanvas(page, 170, -30);
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 8');

  // Line A and line B a quarter from their starts, then the cursor between them places the
  // circle and the click writes it: a circle (3) minus two tangents.
  await pickVariant(page, 'Kružnice', 'Kružnice 2 tečny');
  await clickCanvas(page, -75, 85);
  await clickCanvas(page, -55, -90);
  await clickCanvas(page, -60, 0);
  await expect(status).toHaveText('Stupně volnosti: 9');
  await expect(constraintRowsOf(panel, 'Tečnost')).toHaveCount(2);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a drag from the last point of a polyline draws a tangent arc, then a line goes on', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // A slanted line: two free points.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -150, 60);
  await clickCanvas(page, -30, 20);
  await expect(status).toHaveText('Stupně volnosti: 4');

  // A drag from its end: an arc with the shared start, a new centre and end (4) minus the
  // equal distances of its ends and the tangent.
  await dragOnCanvas(page, [-30, 20], [60, -60]);
  await expect(status).toHaveText('Stupně volnosti: 6');
  await expect(constraintRowsOf(panel, 'Tečnost')).toHaveCount(1);

  // The polyline goes on with a line from the end of the arc: one new point.
  await clickCanvas(page, 150, -80);
  await expect(status).toHaveText('Stupně volnosti: 8');
  await expect(constraintRowsOf(panel, 'Tečnost')).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
