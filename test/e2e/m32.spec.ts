import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  createDocument,
  dimensionInput,
  dimensionValue,
  pickVariant,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The numeric input while drawing (M32; spec 12, "Číselný vstup (M32)") with planegcs in the
// browser, in Czech: the fields of the step stand as labels by the cursor, digits go into the
// active field, Tab locks it and moves on without taking the focus from the canvas, Enter places
// the point. A typed length or diameter becomes a dimension of the sketch; the first point takes
// X and Y without a dimension. The data are read from the exported document (File → Export
// document), the dimensions from the sketch panel.

/** The parts of an exported document the tests read (persistence TinycadFile, spec 05). */
interface ExportedDocument {
  readonly snapshot: {
    readonly document: {
      readonly studio: { readonly features: readonly ExportedFeature[] };
    };
  };
}

interface ExportedFeature {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The sketch entities the tests read (sketch model): only the fields some kinds have. */
interface ExportedEntity {
  readonly kind: string;
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly p1?: string;
  readonly p2?: string;
  readonly radius?: number;
}

/** The sketch constraints the tests read: the kind and the value of a dimension. */
interface ExportedConstraint {
  readonly kind: string;
  readonly value?: number;
}

interface ExportedSketch {
  readonly entities: readonly ExportedEntity[];
  readonly constraints: readonly ExportedConstraint[];
}

/** How close (mm) a point must be to the typed place: the solver keeps it within its tolerance. */
const DIGITS = 6;

/** Into a new sketch on the XY plane; returns its panel. */
async function openSketch(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  return panel;
}

/** The canvas of the view. */
function canvas(page: Page): Locator {
  return page.locator('canvas').first();
}

/**
 * The cursor over the canvas at (dx, dy) px from its centre, without a click, and the keyboard
 * focus in the view: the tool knows the cursor (Enter = a click there) and gets the keys.
 */
async function hoverWithFocus(page: Page, dx: number, dy: number): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  await canvas(page).focus();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** The labels of the numeric input by the cursor (SketchInput, an aria-live wrapper). */
function inputFields(page: Page): Locator {
  return page.locator('[aria-live="polite"]').filter({ has: page.locator('.field') });
}

/** Types a value and Tab or Enter after it. */
async function typeValue(page: Page, text: string, key: 'Tab' | 'Enter'): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press(key);
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** File → Export document; the data of the sketch 'Skica 1'. */
async function exportedSketch(page: Page): Promise<ExportedSketch> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Exportovat dokument', exact: true })
    .click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  // The file is the export of the app under test (TinycadFile); the test reads only the parts
  // described by ExportedDocument.
  const doc = JSON.parse(text) as ExportedDocument;
  const sketch = doc.snapshot.document.studio.features.find((f) => f.name === 'Skica 1');
  // A sketch keeps its data in the params 'entities' and 'constraints' (sketch model, SKETCH_PARAM).
  const entities = sketch?.params['entities'];
  const constraints = sketch?.params['constraints'];
  if (!Array.isArray(entities) || !Array.isArray(constraints))
    throw new Error('no sketch data in Skica 1');
  // The export is the document as stored; parseSketchData checked it when it was written.
  return {
    entities: entities as readonly ExportedEntity[],
    constraints: constraints as readonly ExportedConstraint[],
  };
}

/** The point entity of an id. */
function pointOf(sketch: ExportedSketch, id: string | undefined): { x: number; y: number } {
  const p = sketch.entities.find((e) => e.id === id && e.kind === 'point');
  if (p?.x === undefined || p.y === undefined) throw new Error(`no point ${String(id)}`);
  return { x: p.x, y: p.y };
}

/** The ends of the only line of the sketch. */
function onlyLine(
  sketch: ExportedSketch,
): readonly [{ x: number; y: number }, { x: number; y: number }] {
  const lines = sketch.entities.filter((e) => e.kind === 'line');
  expect(lines).toHaveLength(1);
  return [pointOf(sketch, lines[0]?.p1), pointOf(sketch, lines[0]?.p2)];
}

test('a line of 50 mm at 30° from the keyboard only: exact points and the dimension 50', async ({
  page,
}) => {
  const panel = await openSketch(page);
  await toolbarButton(page, 'Úsečka').click();
  await hoverWithFocus(page, -150, 80);

  // The first point: X and Y by the cursor, the active X takes the digits.
  const fields = inputFields(page);
  await expect(fields).toBeVisible();
  await expect(fields).toContainText('X');
  await expect(fields).toContainText('Y');
  await page.keyboard.type('10');
  await expect(fields).toContainText('10');
  // Tab locks X and moves to Y; the focus stays in the view.
  await page.keyboard.press('Tab');
  await expect(canvas(page)).toBeFocused();
  await typeValue(page, '5', 'Enter');

  // The next point: the length and the angle.
  await expect(fields).toContainText('Délka');
  await expect(fields).toContainText('Úhel');
  await typeValue(page, '50', 'Tab');
  await expect(canvas(page)).toBeFocused();
  await typeValue(page, '30', 'Enter');
  // Escape ends the chain.
  await page.keyboard.press('Escape');

  // The typed length is a dimension of the line.
  const length = await dimensionInput(panel, 'Vzdálenost 1');
  await expect(length).toBeVisible();
  expect(await dimensionValue(length)).toBe(50);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await finishSketch(panel);
  const sketch = await exportedSketch(page);
  const [a, b] = onlyLine(sketch);
  expect(a.x).toBeCloseTo(10, DIGITS);
  expect(a.y).toBeCloseTo(5, DIGITS);
  expect(b.x).toBeCloseTo(10 + 50 * Math.cos(Math.PI / 6), DIGITS);
  expect(b.y).toBeCloseTo(5 + 50 * Math.sin(Math.PI / 6), DIGITS);
  // The first line of a chain at 30°: the length only (no dimension of the angle to an axis).
  expect(sketch.constraints.filter((c) => c.kind === 'distance').map((c) => c.value)).toEqual([50]);
  expect(sketch.constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(0);
});

test('the length from the keyboard and the direction by the mouse: the length is exact', async ({
  page,
}) => {
  const panel = await openSketch(page);
  await toolbarButton(page, 'Úsečka').click();
  // The first point by a click (Alt: off the grid), then the length locked by Tab.
  await page.keyboard.down('Alt');
  await clickCanvas(page, -120, 60);
  await page.keyboard.up('Alt');
  await typeValue(page, '40', 'Tab');
  await expect(canvas(page)).toBeFocused();
  // The direction by a click on a slanted place (up and right, no axis); the length stays 40.
  await clickCanvas(page, 30, -40);
  await page.keyboard.press('Escape');

  const length = await dimensionInput(panel, 'Vzdálenost 1');
  expect(await dimensionValue(length)).toBe(40);

  await finishSketch(panel);
  const [a, b] = onlyLine(await exportedSketch(page));
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(40, DIGITS);
  // The direction follows the mouse: up and right of the first point (y of the plane grows up).
  expect(b.x).toBeGreaterThan(a.x);
  expect(b.y).toBeGreaterThan(a.y);
});

test('a rectangle 40 × 20: two dimensions', async ({ page }) => {
  const panel = await openSketch(page);
  await toolbarButton(page, 'Obdélník rohy').click();
  await hoverWithFocus(page, -100, 60);
  await typeValue(page, '0', 'Tab');
  await typeValue(page, '0', 'Enter');
  // The cursor up and right of the corner picks the quadrant.
  await hoverWithFocus(page, 60, -40);
  const fields = inputFields(page);
  await expect(fields).toContainText('Šířka');
  await expect(fields).toContainText('Výška');
  await typeValue(page, '40', 'Tab');
  await typeValue(page, '20', 'Enter');

  const first = await dimensionInput(panel, 'Vzdálenost 1');
  const second = await dimensionInput(panel, 'Vzdálenost 2');
  const values = [await dimensionValue(first), await dimensionValue(second)].sort((x, y) => x - y);
  expect(values).toEqual([20, 40]);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await finishSketch(panel);
  const sketch = await exportedSketch(page);
  const points = sketch.entities
    .filter((e) => e.kind === 'point')
    .map((p) => pointOf(sketch, p.id));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  expect(Math.min(...xs)).toBeCloseTo(0, DIGITS);
  expect(Math.max(...xs)).toBeCloseTo(40, DIGITS);
  expect(Math.min(...ys)).toBeCloseTo(0, DIGITS);
  expect(Math.max(...ys)).toBeCloseTo(20, DIGITS);
  expect(sketch.constraints.filter((c) => c.kind === 'distance')).toHaveLength(2);
});

test('a circle of ⌀ 30: the dimension of the diameter', async ({ page }) => {
  const panel = await openSketch(page);
  await toolbarButton(page, 'Kružnice').click();
  await page.keyboard.down('Alt');
  await clickCanvas(page, 40, 30);
  await page.keyboard.up('Alt');
  // The diameter takes the direction from the centre to the cursor: the cursor moves off the
  // centre first (on the centre there is no direction and the step would be degenerate).
  await hoverWithFocus(page, 90, 10);
  await expect(inputFields(page)).toContainText('Průměr');
  await typeValue(page, '30', 'Enter');

  const diameter = await dimensionInput(panel, 'Průměr 1');
  expect(await dimensionValue(diameter)).toBe(30);

  await finishSketch(panel);
  const circles = (await exportedSketch(page)).entities.filter((e) => e.kind === 'circle');
  expect(circles).toHaveLength(1);
  expect(circles[0]?.radius).toBeCloseTo(15, DIGITS);
});

test('the first point from X and Y: a point at 12,5; 7 off the grid, no dimension', async ({
  page,
}) => {
  const panel = await openSketch(page);
  await pickVariant(page, 'Úsečka', 'Bod');
  await hoverWithFocus(page, 80, -50);
  // The comma is the Czech decimal mark; the grid snap is on and the typed point ignores it.
  await typeValue(page, '12,5', 'Tab');
  await typeValue(page, '7', 'Enter');
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 2');

  await finishSketch(panel);
  const sketch = await exportedSketch(page);
  const points = sketch.entities.filter((e) => e.kind === 'point');
  expect(points).toHaveLength(1);
  expect(points[0]?.x).toBeCloseTo(12.5, DIGITS);
  expect(points[0]?.y).toBeCloseTo(7, DIGITS);
  expect(sketch.constraints).toHaveLength(0);
});
