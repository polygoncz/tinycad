import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  createDocument,
  dimensionInput,
  dimensionValue,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The dimensions of M19.2 (Ú8, D4) with OCCT and planegcs in the browser, in Czech: a dimension
// of a sketch is drawn over the view with its value rounded to two decimals; the corner of a
// rectangle snaps to the grid, so the value is a multiple of the grid step; a double click on the
// label opens a named field and Enter writes the value the same way as the panel. With the switch
// off the corner does not snap.

/** The rounded text of a dimension: at most two decimals, no trailing zeros. */
const ROUNDED = /^\d+(\.\d{1,2})?$/;

/** The step of the sketch grid for a pixel size: 1–2–5 × 10ⁿ mm, at least 10 px (render). */
function gridStep(worldPerPx: number): number {
  for (let exp = Math.floor(Math.log10(worldPerPx * 10)) - 1; ; exp++) {
    for (const mantissa of [1, 2, 5]) {
      const step = mantissa * 10 ** exp;
      if (step / worldPerPx >= 10) return step;
    }
  }
}

/** Whether a length is a whole number of steps of a grid. */
function onGrid(value: number, step: number): boolean {
  const steps = value / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/**
 * Whether a width drawn across `px` pixels lies on the grid. The pixel size is estimated from the
 * width itself, which snapping moved by at most half a step, so both neighbouring steps count.
 */
function snappedToGrid(value: number, px: number): boolean {
  const worldPerPx = value / px;
  return [gridStep(worldPerPx * 0.9), gridStep(worldPerPx * 1.1)].some((s) => onGrid(value, s));
}

/** The label of a dimension in the view, named by its rounded value. */
function viewLabel(page: Page, text: string): Locator {
  return page.getByRole('button', { name: text, exact: true });
}

/**
 * A rectangle from (x0, y0) to (x1, y1) px from the canvas centre and a dimension of its bottom:
 * the click on the edge hangs the dimension on the cursor, the click below the edge places it
 * (M28); the edge is horizontal, so the dimension is the horizontal distance.
 */
async function rectangleWithWidth(
  page: Page,
  status: Locator,
  [x0, y0]: readonly [number, number],
  [x1, y1]: readonly [number, number],
  dofAfter: string,
): Promise<void> {
  await toolbarButton(page, 'Obdélník').click();
  await clickCanvas(page, x0, y0);
  await clickCanvas(page, x1, y1);
  await expect(status).toHaveText(dofAfter);
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, (x0 + x1) / 2, Math.max(y0, y1));
  await clickCanvas(page, (x0 + x1) / 2, Math.max(y0, y1) + 40);
}

test('dimensions in the view: rounded, snapped to the grid, edited in place', async ({ page }) => {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const status = panel.getByRole('status');
  const snap = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'true');

  // A rectangle from the origin to a corner off any round number of px: it snaps to the grid.
  await rectangleWithWidth(page, status, [0, 0], [123, -77], 'Stupně volnosti: 2');
  const width = dimensionInput(panel, 'Vodorovná vzdálenost 1');
  await expect(width).toBeVisible();
  const shown = await width.inputValue();
  expect(shown).toMatch(ROUNDED);
  const value = Number(shown);
  expect(value).toBeGreaterThan(0);
  expect(snappedToGrid(value, 123)).toBe(true);

  // The label in the view shows the same rounded value.
  const label = viewLabel(page, shown);
  await expect(label).toBeVisible();

  // Double click → a field named like the panel row; 40 + Enter writes it.
  await label.dblclick();
  const field = page.locator('input[aria-label="Vodorovná vzdálenost 1"]');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(shown);
  await field.fill('40');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(width).toHaveValue('40');
  await expect(viewLabel(page, '40')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // Esc closes the field without writing.
  await viewLabel(page, '40').dblclick();
  await field.fill('55');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(width).toHaveValue('40');

  // Without snapping, a corner off the grid stays off it.
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await rectangleWithWidth(page, status, [-260, 60], [-137, 137], 'Stupně volnosti: 5');
  const free = dimensionInput(panel, 'Vodorovná vzdálenost 2');
  await expect(free).toBeVisible();
  const freeValue = await dimensionValue(free);
  expect(snappedToGrid(freeValue, 123)).toBe(false);
});
