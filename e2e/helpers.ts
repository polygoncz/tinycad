import { expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Steps shared by the e2e scenarios. Elements are found only by their roles and accessible
// names (spec 11, "Přístupnost").

/** From the document list to an open, empty document. */
export async function createDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nový', exact: true }).click();
  await expect(page).toHaveURL(/#\/d\//);
  // The toolbar is there once the session is open.
  await expect(page.getByRole('button', { name: 'Kvádr', exact: true })).toBeEnabled();
}

/** The input of a param field of the open dialog, named by its label. */
export function paramInput(page: Page, label: string): Locator {
  return page.getByRole('dialog').getByRole('textbox', { name: label, exact: true });
}

/** Types the value into the param field and leaves it: the field reports its value on change. */
export async function fillParam(page: Page, label: string, value: string): Promise<void> {
  const input = paramInput(page, label);
  await input.fill(value);
  await input.press('Tab');
}

/** The item of the feature in the Timeline, named by the feature name. */
export function timelineFeature(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

/** Reloads the page once the log is in IndexedDB (the green dot of the title bar). */
export async function reloadWhenSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await page.reload();
}

/**
 * A tool or action button of the toolbar. The label of a group is a button with the same name
 * as a tool ("Skica"), and Finish / Cancel are in the sketch panel too; the tool buttons are
 * named by aria-label, the group labels by their text, so the label picks the tool.
 */
export function toolbarButton(page: Page, name: string): Locator {
  return page.getByRole('navigation').getByLabel(name, { exact: true });
}

/** The panel of the open sketch, named by the sketch. */
export function sketchPanel(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The value field of a dimension in the sketch panel, named by its row ("Vzdálenost 1"). */
export function dimensionInput(panel: Locator, label: string): Locator {
  return panel.getByRole('textbox', { name: label, exact: true });
}

/** The number in a dimension field, '.' or ',' as the decimal mark. */
export async function dimensionValue(input: Locator): Promise<number> {
  return Number((await input.inputValue()).replace(',', '.'));
}

/** Clicks the canvas at (dx, dy) px from its centre. */
export async function clickCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  // Move first, so the tool sees the hover (snap) before the press.
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

/**
 * Into a new sketch on the XY plane of an empty scene: a rectangle (0, 0) → (120, −80) px snapped
 * onto the origin and dimensions of its bottom and right edge make it fully defined. The sketch
 * stays open; returns its panel. An empty scene has the origin in the middle of the canvas once
 * the camera looks along the normal of the sketch plane; screen y grows down, so the rectangle
 * lies in +x, +y of the plane.
 */
export async function drawDimensionedRectangle(page: Page, sketch: string): Promise<Locator> {
  // Into the sketch mode: the toolbar shows the sketcher, the panel is there.
  await toolbarButton(page, 'Skica').click();
  await expect(toolbarButton(page, 'Úsečka')).toBeVisible();
  await expect(toolbarButton(page, 'Obdélník')).toBeVisible();
  const panel = sketchPanel(page, sketch);
  await expect(panel).toBeVisible();
  const status = panel.getByRole('status');

  // A rectangle from the origin (snap → fix): two degrees of freedom stay (width, height).
  await toolbarButton(page, 'Obdélník').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 120, -80);
  await expect(status).toHaveText('Stupně volnosti: 2');

  // Dimensions of the bottom and the right edge → fully defined.
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, 60, 0);
  await clickCanvas(page, 120, -40);
  await expect(status).toHaveText('Plně určeno');
  await expect(dimensionInput(panel, 'Vzdálenost 1')).toBeVisible();
  await expect(dimensionInput(panel, 'Vzdálenost 2')).toBeVisible();
  return panel;
}
