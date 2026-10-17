import { randomUUID } from 'node:crypto';
import { documentService } from './core';
import { expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Steps shared by the e2e scenarios. Elements are found only by their roles and accessible
// names (spec 11, "Přístupnost").

/** A document of one test on the core of the run. */
export interface ServerDocument {
  readonly id: string;
  readonly name: string;
}

/**
 * A new empty document on the core, made from Node over DocumentService (N72): the workers share
 * the core, so every test works in its own document, named uniquely unless `name` says otherwise.
 */
export async function createServerDocument(name?: string): Promise<ServerDocument> {
  const { document } = await documentService().createDocument({
    operationId: randomUUID(),
    name: name ?? `e2e ${randomUUID().slice(0, 8)}`,
  });
  if (document === undefined) throw new Error('CreateDocument answered no document');
  return { id: document.documentId, name: document.name };
}

/** The route of the document in the app. */
export function documentRoute(doc: ServerDocument): string {
  return `/#/d/${doc.id}`;
}

/**
 * A new empty document of this test (createServerDocument), open in the page. Resolves once the
 * session is open and writable (the toolbar is enabled).
 */
export async function createDocument(page: Page, name?: string): Promise<ServerDocument> {
  const doc = await createServerDocument(name);
  await page.goto(documentRoute(doc));
  await expect(page.getByRole('button', { name: 'Kvádr', exact: true })).toBeEnabled();
  return doc;
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

/** Reloads the page once the core has confirmed every change (the green dot of the title bar). */
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

/**
 * The collapsible section of the constraints in the sketch panel (a <details>, role group),
 * collapsed by default (M25).
 */
export function constraintSection(panel: Locator): Locator {
  return panel.getByRole('group');
}

/**
 * Opens the section of the constraints in the sketch panel, unless it is open already. A new
 * dimension opens the section by itself a tick later (focusNewDimension) and focuses its field;
 * a click in that moment would close the section again and take the focus, so the section gets
 * a second to open by itself first.
 */
export async function openConstraintSection(panel: Locator): Promise<void> {
  const section = constraintSection(panel);
  try {
    await expect(section).toHaveJSProperty('open', true, { timeout: 1000 });
    return;
  } catch {
    // Still collapsed: open it.
  }
  await panel.getByText('Vazby', { exact: true }).click();
  await expect(section).toHaveJSProperty('open', true);
}

/**
 * The value field of a dimension in the sketch panel, named by its row ("Vodorovná vzdálenost 1"). The
 * section of the constraints is opened first, so the field can be seen and edited.
 */
export async function dimensionInput(panel: Locator, label: string): Promise<Locator> {
  await openConstraintSection(panel);
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
  await expect(toolbarButton(page, 'Obdélník rohy')).toBeVisible();
  const panel = sketchPanel(page, sketch);
  await expect(panel).toBeVisible();
  const status = panel.getByRole('status');

  // A rectangle from the origin (snap → fix): two degrees of freedom stay (width, height). The
  // corner is placed with Alt held, so it does not snap to the grid (M19.2 D4) and its edges stay
  // under the clicks below.
  await toolbarButton(page, 'Obdélník rohy').click();
  await clickCanvas(page, 0, 0);
  await page.keyboard.down('Alt');
  await clickCanvas(page, 120, -80);
  await page.keyboard.up('Alt');
  await expect(status).toHaveText('Stupně volnosti: 2');

  // Dimensions of the bottom and the right edge → fully defined. A click on an edge hangs its
  // dimension on the cursor, the next click beside the edge places it (M28); the bottom is
  // horizontal and the right edge vertical, so they get the horizontal and the vertical distance.
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, 60, 0);
  await clickCanvas(page, 60, 40);
  await clickCanvas(page, 120, -40);
  await clickCanvas(page, 160, -40);
  await expect(status).toHaveText('Plně určeno');
  await expect(await dimensionInput(panel, 'Vodorovná vzdálenost 1')).toBeVisible();
  await expect(await dimensionInput(panel, 'Svislá vzdálenost 1')).toBeVisible();
  return panel;
}

/** Toolbar → the dialog of the new feature, named by the feature. */
export async function openTool(page: Page, tool: string, feature: string): Promise<Locator> {
  await toolbarButton(page, tool).click();
  const dialog = page.getByRole('dialog', { name: feature, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Opens the edit dialog of a feature by a double click in the Timeline and waits until the view
 * shows the input of the feature (ADR 0025): the app reads the model again with input_of once the
 * dialog is open, and until that answer is in, the view still shows the result of the feature, so
 * a pick would hit it.
 */
export async function editFeatureWithInput(page: Page, name: string): Promise<Locator> {
  const inputRead = page.waitForResponse((r) => r.url().endsWith('/GetReadModel'));
  await timelineFeature(page, name).dblclick();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  await inputRead;
  return dialog;
}

/** OK of the feature dialog; the dialog closes. */
export async function confirmDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The button of a reference field of the dialog, named by its label and its own text. */
export function refField(dialog: Locator, label: string): Locator {
  return dialog.getByRole('button', { name: new RegExp(`^${label} `) });
}

/** No feature of the model has an error: the Timeline shows no "Chyby: n". */
export async function expectNoErrors(page: Page): Promise<void> {
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);
}

type Point3 = readonly [number, number, number];

/**
 * Where a model point lies on the canvas, in px from its centre (x right, y down), in the iso
 * view fitted on the bounds `min`…`max` – after "Zobrazit vše" (F) in a new document, whose
 * camera stays put (M19.2 D7; spec 09: the iso view, orthographic camera). The same math as the
 * camera fit of render (camera-math fitOrtho, margin 10 %), repeated here so the test clicks
 * computed coordinates and needs no hook into the page.
 */
export async function isoCanvasOffset(
  page: Page,
  min: Point3,
  max: Point3,
  point: Point3,
): Promise<{ dx: number; dy: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  // The iso camera looks from (1, −1, 1); up is +Z in the view plane, right = up × direction.
  const right: Point3 = [1 / Math.SQRT2, 1 / Math.SQRT2, 0];
  const up: Point3 = [-1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
  const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const target: Point3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const rel = (p: Point3): Point3 => [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
  let halfWidth = 0;
  let halfHeight = 0;
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const r = rel([x, y, z]);
        halfWidth = Math.max(halfWidth, Math.abs(dot(r, right)));
        halfHeight = Math.max(halfHeight, Math.abs(dot(r, up)));
      }
  const aspect = box.width / box.height;
  const visibleHalfHeight = 1.1 * Math.max(halfHeight, halfWidth / aspect);
  const pxPerMm = box.height / 2 / visibleHalfHeight;
  const r = rel(point);
  return { dx: dot(r, right) * pxPerMm, dy: -dot(r, up) * pxPerMm };
}

/** The arrow ▾ of the split button of a tool family, named by the shown variant. */
export function variantsButton(page: Page, shown: string): Locator {
  return page
    .getByRole('navigation')
    .getByRole('button', { name: `Další způsoby: ${shown}`, exact: true });
}

/** Opens the menu of the variants by the arrow of the family showing `shown` and picks `variant`. */
export async function pickVariant(page: Page, shown: string, variant: string): Promise<void> {
  await variantsButton(page, shown).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: new RegExp(`^${variant}( |$)`) }).click();
  await expect(menu).toBeHidden();
}

/** A point on the canvas in px from its centre (x right, y down). */
export type CanvasOffset = readonly [dx: number, dy: number];

/** The page coordinates of a point px from the canvas centre. */
export async function canvasPoint(page: Page, [dx, dy]: CanvasOffset): Promise<CanvasOffset> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  return [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];
}

/** Drags with the left button in `steps` moves between two points px from the canvas centre. */
export async function dragOnCanvas(
  page: Page,
  from: CanvasOffset,
  to: CanvasOffset,
  steps = 20,
): Promise<void> {
  const [x0, y0] = await canvasPoint(page, from);
  const [x1, y1] = await canvasPoint(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

/** The bounds of the block of createExtrudedBlock, mm. */
const BLOCK_MIN: Point3 = [0, 0, 0];
const BLOCK_MAX: Point3 = [40, 20, 10];

/**
 * In an empty document: a rectangle 40 × 20 mm from the origin (Skica 1) extruded 10 mm
 * (Vysunutí 1), then "Zobrazit vše" (F), so isoCanvasOffset knows where the block is. Resolves
 * once the core has confirmed it.
 */
export async function createExtrudedBlock(page: Page): Promise<void> {
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  for (const [label, value] of [
    ['Vodorovná vzdálenost 1', '40'],
    ['Svislá vzdálenost 1', '20'],
  ] as const) {
    const input = await dimensionInput(panel, label);
    await input.fill(value);
    await input.press('Enter');
  }
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  // The extrude preselects the region of the last read model (D6 of M19.2).
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  await fillParam(page, 'Vzdálenost', '10');
  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  // The sketch left the camera looking along its normal: back to the iso view, then fitted. The
  // camera eases into each view, so each gets time to settle.
  await page.getByRole('navigation').getByRole('button', { name: 'Zobrazit', exact: true }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Izometrický( |$)/ })
    .click();
  await page.waitForTimeout(600);
  await page.keyboard.press('f');
  await page.waitForTimeout(600);
}

/**
 * Where to grab the arrow of the distance of the extrude of createExtrudedBlock while its dialog
 * is open: the arrow stands on the middle of the top face, (20, 10, 10), points up (+z) and its
 * shaft starts 14 px from that point (interaction MANIPULATOR_GLYPHS).
 */
export async function extrudeArrowGrip(page: Page): Promise<CanvasOffset> {
  const { dx, dy } = await isoCanvasOffset(page, BLOCK_MIN, BLOCK_MAX, [20, 10, 10]);
  return [dx, dy - 24];
}
