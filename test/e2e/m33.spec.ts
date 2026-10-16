import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  expectNoErrors,
  openConstraintSection,
  openTool,
  pickVariant,
  refField,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The scenarios of M33 (spec 12, "Trim, extend, split (M33)") with OCCT and planegcs in the
// browser, in Czech: the overshooting side of a profile crosses its first corner (no region),
// trimming the overshoot closes the profile and it extrudes; a line is extended to a circle and
// ends on it; a line is split in two collinear lines. The grid snap is switched off, so the clicks
// land where they are. The data are read from the exported document (File → Export document).

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

/** The sketch entities the tests read (sketch model). */
type ExportedEntity =
  | { readonly kind: 'point'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly id: string; readonly p1: string; readonly p2: string }
  | {
      readonly kind: 'circle';
      readonly id: string;
      readonly center: string;
      readonly radius: number;
    }
  | { readonly kind: 'arc' | 'bspline' | 'fitSpline'; readonly id: string };

/** The sketch constraints the tests read (sketch model). */
interface ExportedConstraint {
  readonly kind: string;
  readonly point?: string;
  readonly curve?: string;
  readonly a?: string;
  readonly b?: string;
}

/** Into a new sketch with the grid snap off and the constraint list open; returns the panel. */
async function openSketchWithoutGrid(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  // Opened before drawing: a click into the panel takes the focus from the view, whose keys
  // (Escape of the tools) need it until the next click on the canvas (as in m26).
  await openConstraintSection(panel);
  return panel;
}

/** Clicks the canvas at the point, px from its centre. */
async function clickAt(page: Page, p: readonly [number, number]): Promise<void> {
  await clickCanvas(page, p[0], p[1]);
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** File → Export document; the parsed file. */
async function exportDocument(page: Page): Promise<ExportedDocument> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Exportovat dokument', exact: true })
    .click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  // The file is the export of the app under test (TinycadFile); the test reads only the parts
  // described by ExportedDocument.
  return JSON.parse(text) as ExportedDocument;
}

/** The data param of the sketch feature named by its display name. */
function sketchParam(doc: ExportedDocument, sketch: string, param: string): readonly unknown[] {
  const found = doc.snapshot.document.studio.features.find((f) => f.name === sketch);
  const value = found?.params[param];
  if (!Array.isArray(value)) throw new Error(`no ${param} in ${sketch}`);
  return value;
}

async function sketchData(page: Page): Promise<{
  readonly entities: readonly ExportedEntity[];
  readonly constraints: readonly ExportedConstraint[];
}> {
  const doc = await exportDocument(page);
  // The export is the document as stored; parseSketchData checked it when it was written.
  return {
    entities: sketchParam(doc, 'Skica 1', 'entities') as readonly ExportedEntity[],
    constraints: sketchParam(doc, 'Skica 1', 'constraints') as readonly ExportedConstraint[],
  };
}

function ofKind<K extends ExportedEntity['kind']>(
  entities: readonly ExportedEntity[],
  kind: K,
): Extract<ExportedEntity, { kind: K }>[] {
  return entities.filter((e): e is Extract<ExportedEntity, { kind: K }> => e.kind === kind);
}

/** The position of the sketch point, mm. */
function pointAt(entities: readonly ExportedEntity[], id: string): readonly [number, number] {
  const point = entities.find((e) => e.id === id);
  if (point?.kind !== 'point') throw new Error(`no point ${id}`);
  return [point.x, point.y];
}

test('trimming the overshoot of a side closes the profile: a region and an extrude', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. Four lines with the line tool: left, top, right side and the bottom side past the first
  // corner (screen y down). The bottom crosses the first corner: a crossing, no region.
  const first = [-80, 60] as const;
  await toolbarButton(page, 'Úsečka').click();
  for (const p of [first, [-80, -60], [80, -60], [80, 60], [-120, 60]] as const) {
    await clickAt(page, p);
  }
  await page.keyboard.press('Escape');
  // Five points (10) minus vertical, horizontal, vertical, horizontal and the inferred alignment
  // of the last point.
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 2. Trim (T) the overshoot left of the first corner: the bottom ends in the first corner, its
  // free end point goes. The tool needs the intersections of the current data from the kernel;
  // until they are there a click does nothing, so it is repeated until the sketch changes (a
  // click on the removed piece does nothing either).
  await page.keyboard.press('t');
  await expect(async () => {
    await clickAt(page, [-100, 60]);
    await expect(status).toHaveText('Stupně volnosti: 4', { timeout: 1000 });
  }).toPass();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. The bottom ends in the first corner: four points, four lines, one region extruded.
  const { entities } = await sketchData(page);
  expect(ofKind(entities, 'point')).toHaveLength(4);
  expect(ofKind(entities, 'line')).toHaveLength(4);
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  await expect(refField(extrude, 'Oblasti')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);
});

test('a line extended to a circle ends on it', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A horizontal line left of a circle on the same height (screen y down).
  await toolbarButton(page, 'Úsečka').click();
  await clickAt(page, [-100, 30]);
  await clickAt(page, [20, 30]);
  await page.keyboard.press('Escape');
  await toolbarButton(page, 'Kružnice').click();
  await clickAt(page, [100, 30]);
  await clickAt(page, [100, -10]);
  // The line (4) minus horizontal, the circle (3) minus the alignment of its centre.
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 2. Extend: a click near the right end moves it onto the circle (pointOnCurve: one less).
  await pickVariant(page, 'Ořezat', 'Prodloužit');
  await clickAt(page, [10, 30]);
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. The end of the line lies on the circle, on its near side, with pointOnCurve to it.
  const { entities, constraints } = await sketchData(page);
  const [line] = ofKind(entities, 'line');
  const [circle] = ofKind(entities, 'circle');
  if (line === undefined || circle === undefined) throw new Error('no line or circle');
  const start = pointAt(entities, line.p1);
  const end = pointAt(entities, line.p2);
  const center = pointAt(entities, circle.center);
  expect(Math.hypot(end[0] - center[0], end[1] - center[1])).toBeCloseTo(circle.radius, 6);
  expect(end[1]).toBeCloseTo(start[1], 6);
  expect(end[0]).toBeLessThan(center[0]);
  expect(constraints).toContainEqual(
    expect.objectContaining({ kind: 'pointOnCurve', point: line.p2, curve: circle.id }),
  );
});

test('a line split in two: collinear lines sharing the new point', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A horizontal line: four coordinates minus horizontal.
  await toolbarButton(page, 'Úsečka').click();
  await clickAt(page, [-100, 30]);
  await clickAt(page, [100, 30]);
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 3');

  // 2. Split in the middle: three points on one horizontal line (parallel keeps them in line).
  await pickVariant(page, 'Ořezat', 'Rozdělit');
  await clickAt(page, [20, 30]);
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  const { entities, constraints } = await sketchData(page);
  const lines = ofKind(entities, 'line');
  expect(lines).toHaveLength(2);
  expect(ofKind(entities, 'point')).toHaveLength(3);
  const [left, right] = lines;
  if (left === undefined || right === undefined) throw new Error('no lines');
  expect(right.p1).toBe(left.p2);
  expect(constraints).toContainEqual(
    expect.objectContaining({ kind: 'parallel', a: left.id, b: right.id }),
  );
});
