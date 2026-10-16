import { readFile } from 'node:fs/promises';
import { bspline } from '@/core';
import type { BSplineShape, Vec2 } from '@/core';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  expectNoErrors,
  isoCanvasOffset,
  openConstraintSection,
  openTool,
  pickVariant,
  refField,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenarios of M29 (Ú8d; spec 12, "Spliny (M29)", "Nástroje") with OCCT and planegcs in the
// browser, in Czech: a profile of three lines and a spline through points is extruded and the side
// face of the spline is named face:side:<id of the spline>; a control point spline gets clamped
// uniform knots and a click on its control polygon selects it; a spline through points still
// passes through all of them after one is dragged; Escape while drawing writes nothing. The grid
// snap is switched off, so the clicks land where they are. The data are read from the exported
// document (File → Export document) and the curves are evaluated with bspline of core.

/** The parts of an exported document the tests read (persistence TinycadFile, spec 05). */
interface ExportedDocument {
  readonly snapshot: {
    readonly document: {
      readonly studio: { readonly features: readonly ExportedFeature[] };
    };
  };
}

interface ExportedFeature {
  readonly id: string;
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The sketch entities the tests read (sketch model: point, bspline, fitSpline). */
type ExportedEntity =
  | { readonly kind: 'point'; readonly id: string; readonly x: number; readonly y: number }
  | {
      readonly kind: 'bspline';
      readonly id: string;
      readonly degree: number;
      readonly poles: readonly string[];
      readonly knots: readonly number[];
      readonly construction?: true;
    }
  | {
      readonly kind: 'fitSpline';
      readonly id: string;
      readonly degree: number;
      readonly fit: readonly string[];
      readonly params: readonly number[];
      readonly poles: readonly Vec2[];
      readonly knots: readonly number[];
    }
  | { readonly kind: 'line' | 'circle' | 'arc'; readonly id: string };

/** How far (mm) a fit point may lie from its spline. */
const MM_TOLERANCE = 1e-6;

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
  // (Enter and Escape of the tools) need it until the next click on the canvas (as in m26).
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

/** Drags with the left button from `from` to `to`, px from the canvas centre. */
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
  // described by ExportedDocument; the readers below check the arrays they rely on.
  return JSON.parse(text) as ExportedDocument;
}

/** The feature of the exported document, named by its display name. */
function feature(doc: ExportedDocument, name: string): ExportedFeature {
  const found = doc.snapshot.document.studio.features.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no feature ${name}`);
  return found;
}

/** The entities of the sketch feature. */
function entitiesOf(doc: ExportedDocument, sketch: string): readonly ExportedEntity[] {
  // A sketch keeps its entities in the data param 'entities' (sketch model, SKETCH_PARAM).
  const entities = feature(doc, sketch).params['entities'];
  if (!Array.isArray(entities)) throw new Error(`no entities in ${sketch}`);
  // The export is the document as stored; parseSketchData checked it when it was written.
  return entities as readonly ExportedEntity[];
}

/** The only entity of the kind in the sketch. */
function only<K extends ExportedEntity['kind']>(
  entities: readonly ExportedEntity[],
  kind: K,
): Extract<ExportedEntity, { kind: K }> {
  const found = entities.filter((e): e is Extract<ExportedEntity, { kind: K }> => e.kind === kind);
  expect(found).toHaveLength(1);
  const [first] = found;
  if (first === undefined) throw new Error(`no ${kind}`);
  return first;
}

/** The position of the sketch point, mm. */
function pointAt(entities: readonly ExportedEntity[], id: string): Vec2 {
  const point = entities.find((e) => e.id === id);
  if (point?.kind !== 'point') throw new Error(`no point ${id}`);
  return [point.x, point.y];
}

/** The curve of a fit spline (its solved control points). */
function fitShape(spline: Extract<ExportedEntity, { kind: 'fitSpline' }>): BSplineShape {
  return { degree: spline.degree, poles: spline.poles, knots: spline.knots };
}

test('a profile of lines and a spline through points: extrude, face:side:<id of the spline>', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. Three sides of a square with the line tool: top, left, bottom (screen y down); Escape ends
  // the chain.
  const topRight = [80, -60] as const;
  const topLeft = [-80, -60] as const;
  const bottomLeft = [-80, 60] as const;
  const bottomRight = [80, 60] as const;
  await toolbarButton(page, 'Úsečka').click();
  for (const p of [topRight, topLeft, bottomLeft, bottomRight]) await clickAt(page, p);
  await page.keyboard.press('Escape');
  // Four points (8) minus horizontal, vertical, horizontal and the vAlign of the last point with
  // the first. Waited for: the snapper of the next tool sees the last line only once the session
  // has it, after its solve (in WebKit it would otherwise get a new point there).
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 4');

  // 2. The fourth side with "Spline přes body": from the end of the last line (snapped onto it)
  // through a point bulging to +x into the start of the first line; Enter ends it. The right side
  // faces the iso camera, so its edge can be picked later.
  await pickVariant(page, 'Spline přes řídicí body', 'Spline přes body');
  await clickAt(page, bottomRight);
  await clickCanvas(page, 115, 0);
  await clickAt(page, topRight);
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. Extrude takes the only region by itself: one body.
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  await expect(refField(extrude, 'Oblasti')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);

  // 4. The sketch has the four points of the square, three lines and the spline through three of
  // them, the first and the last shared with the lines (no new points on them).
  const doc = await exportDocument(page);
  const entities = entitiesOf(doc, 'Skica 1');
  expect(entities.filter((e) => e.kind === 'point')).toHaveLength(5);
  expect(entities.filter((e) => e.kind === 'line')).toHaveLength(3);
  const spline = only(entities, 'fitSpline');
  expect(spline.fit).toHaveLength(3);
  const shape = fitShape(spline);
  const extrudeFeature = feature(doc, 'Vysunutí 1');
  const depth = extrudeFeature.params['distance'];
  if (typeof depth !== 'number') throw new Error('no distance of the extrude');

  // 5. The iso view fitted on the body; a fillet of the top edge of the spline side, in the middle
  // of the spline. Its reference names the side face of the spline.
  await page.getByRole('navigation').getByRole('button', { name: 'Zobrazit', exact: true }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Izometrický( |$)/ })
    .click();
  await page.keyboard.press('f');
  const outline = [
    ...entities.flatMap((e): Vec2[] => (e.kind === 'point' ? [[e.x, e.y]] : [])),
    ...bspline.tessellate(shape, 1e-4),
  ];
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const min = [Math.min(...xs), Math.min(...ys), 0] as const;
  const max = [Math.max(...xs), Math.max(...ys), depth] as const;
  const [ex, ey] = bspline.evaluate(shape, 0.5);
  const { dx, dy } = await isoCanvasOffset(page, min, max, [ex, ey, depth]);

  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  const edges = refField(fillet, 'Hrany');
  await expect(edges).toHaveAttribute('aria-pressed', 'true');
  await clickCanvas(page, dx, dy);
  await expect(edges).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(fillet);
  await expect(timelineFeature(page, 'Zaoblení 1')).toBeVisible();
  await expectNoErrors(page);

  const filleted = await exportDocument(page);
  const refs: unknown = feature(filleted, 'Zaoblení 1').params['edges'];
  if (!Array.isArray(refs)) throw new Error('no edges in Zaoblení 1');
  expect(refs).toHaveLength(1);
  const ref: unknown = refs[0];
  const name: unknown = typeof ref === 'object' && ref !== null ? Reflect.get(ref, 'name') : null;
  expect(name).toContain(`${extrudeFeature.id}/face:side:${spline.id}`);
});

test('a control point spline: uniform knots, a click on its control polygon selects it', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. Five control points of a zigzag, then a click on the last one ends the spline.
  const poles = [
    [-160, 60],
    [-80, -80],
    [0, 60],
    [80, -80],
    [160, 60],
  ] as const;
  await toolbarButton(page, 'Spline přes řídicí body').click();
  for (const p of poles) await clickAt(page, p);
  const last = poles[poles.length - 1] ?? poles[0];
  await clickAt(page, last);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  // The empty sketch was fully defined; the solved spline brings free points (the click on its
  // control polygon below needs the spline in the session).
  await expect(status).toHaveText(/^Stupně volnosti: /);

  // 2. Escape back to the select tool; a click on the control polygon between the second and the
  // third pole, 40 px from the third and 38 px from the curve, selects the spline: "Konstrukční"
  // (Q) is enabled only for a selected curve, so the spline becomes a construction one.
  await page.keyboard.press('Escape');
  await clickCanvas(page, -20, 25);
  await page.keyboard.press('q');
  await finishSketch(panel);

  // 3. In the data: a cubic bspline over five points with the clamped uniform knots, construction.
  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const spline = only(entities, 'bspline');
  expect(spline.degree).toBe(3);
  expect(spline.poles).toHaveLength(5);
  expect(spline.knots).toEqual([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
  expect(spline.construction).toBe(true);
  expect(entities.filter((e) => e.kind === 'point')).toHaveLength(5);
});

test('a spline through points passes through all of them after one is dragged', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. Four fit points, none aligned with another (no hAlign / vAlign inferred), Enter ends.
  const fit = [
    [-150, 30],
    [-60, -50],
    [40, 45],
    [140, -20],
  ] as const;
  await pickVariant(page, 'Spline přes řídicí body', 'Spline přes body');
  for (const p of fit) await clickAt(page, p);
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 8');

  // 2. Escape back to the select tool, the second fit point dragged 60 px up.
  await page.keyboard.press('Escape');
  const target = [-60, -110] as const;
  await dragOnCanvas(page, fit[1], target);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. The dragged point is where it was dropped (px → mm from the first and the last point,
  // which did not move; the origin is in the middle of the canvas, screen y down), and the solved
  // spline passes through every fit point at its parameter.
  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const spline = only(entities, 'fitSpline');
  expect(spline.fit).toHaveLength(4);
  const points = spline.fit.map((id) => pointAt(entities, id));
  const [first, dragged, , lastPoint] = points;
  if (first === undefined || dragged === undefined || lastPoint === undefined)
    throw new Error('missing fit points');
  const mmPerPx = (lastPoint[0] - first[0]) / (fit[3][0] - fit[0][0]);
  expect(Math.abs(dragged[0] - target[0] * mmPerPx)).toBeLessThan(mmPerPx);
  expect(Math.abs(dragged[1] + target[1] * mmPerPx)).toBeLessThan(mmPerPx);
  const shape = fitShape(spline);
  points.forEach((p, i) => {
    const t = spline.params[i];
    if (t === undefined) throw new Error('missing parameter');
    const [x, y] = bspline.evaluate(shape, t);
    expect(Math.hypot(x - p[0], y - p[1])).toBeLessThan(MM_TOLERANCE);
  });
});

test('Escape while drawing a spline writes nothing, the tool stays', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');
  const empty = await status.textContent();

  // 1. Two points of a spline, Escape: nothing written; Enter after it writes nothing either.
  await pickVariant(page, 'Spline přes řídicí body', 'Spline přes body');
  await clickCanvas(page, -100, 40);
  await clickCanvas(page, 50, -30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(empty ?? '');

  // 2. The tool is still active: two more points and Enter write a spline of two points.
  await clickCanvas(page, -120, -60);
  await clickCanvas(page, 90, 70);
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Stupně volnosti: 4');
  await finishSketch(panel);

  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  expect(only(entities, 'fitSpline').fit).toHaveLength(2);
  expect(entities.filter((e) => e.kind === 'point')).toHaveLength(2);
});
