import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  createDocument,
  expectNoErrors,
  openConstraintSection,
  pickVariant,
  reloadWhenSaved,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenarios of M36 (Ú6; spec 12, "Zrcadlení a pole (M36)") with OCCT and planegcs in the
// browser, in Czech: a line mirrored across another line, a linear pattern of a circle grown into
// the second direction by its label "1×", a circular pattern of a circle around the end of a line,
// and the count of a linear pattern changed by its label in the view and kept after a reload.
// The tools go sources → Enter → axis or centre; the sources are picked by clicks on the canvas,
// so the view keeps the focus for Enter. The copies are no data (only the recipe is), so they are
// checked in the view: a click on a copy selects its pattern, whose labels then show (a mirror has
// none, so it is deleted instead). The grid snap is off, so the clicks land where they are and the
// positions are worked out in px (the view scale is uniform, so mirroring and spacing hold in px).

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

interface ExportedDirection {
  readonly angle: number;
  readonly count: number;
  readonly spacing: number;
}

/** The sketch entities the tests read (sketch model). */
type ExportedEntity =
  | {
      readonly kind: 'mirror';
      readonly id: string;
      readonly sources: readonly string[];
      readonly axis: string;
    }
  | {
      readonly kind: 'linearPattern';
      readonly id: string;
      readonly sources: readonly string[];
      readonly direction1: ExportedDirection;
      readonly direction2?: ExportedDirection;
    }
  | {
      readonly kind: 'circularPattern';
      readonly id: string;
      readonly sources: readonly string[];
      readonly center: string;
      readonly count: number;
      readonly angle: number;
    }
  | PlainEntity<'point'>
  | PlainEntity<'line'>
  | PlainEntity<'circle'>;

/** A point or a curve, of which the tests read only the id. */
interface PlainEntity<K extends string> {
  readonly kind: K;
  readonly id: string;
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
  // (Enter and Escape of the tools) need it until the next click on the canvas (as in m29).
  await openConstraintSection(panel);
  return panel;
}

/** Clicks the canvas at the point, px from its centre. */
async function clickAt(page: Page, p: readonly [number, number]): Promise<void> {
  await clickCanvas(page, p[0], p[1]);
}

/** A line from `from` to `to` with the line tool; Escape ends the chain. */
async function drawLine(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  await toolbarButton(page, 'Úsečka').click();
  await clickAt(page, from);
  await clickAt(page, to);
  await page.keyboard.press('Escape');
}

/** A circle around `centre` with the radius in px (a click right of the centre). */
async function drawCircle(
  page: Page,
  centre: readonly [number, number],
  radius: number,
): Promise<void> {
  await toolbarButton(page, 'Kružnice').click();
  await clickAt(page, centre);
  await clickAt(page, [centre[0] + radius, centre[1]]);
  await page.keyboard.press('Escape');
}

/** Where a click on the canvas hits nothing in these scenarios, px from its centre. */
const EMPTY = [150, -150] as const;

/**
 * Back to the select tool with nothing selected: a click on empty canvas gives the view the focus
 * (a field of a label may have taken it) and hits nothing, the first Escape clears the selection
 * (the new pattern) and the second leaves the pattern tool.
 */
async function leaveTool(page: Page): Promise<void> {
  await clickAt(page, EMPTY);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** The label of a pattern parameter in the view ("Počet 3×", "Rozteč 15 mm"). */
function patternLabel(page: Page, name: string, value: string): Locator {
  return page.getByRole('button', { name: `${name} ${value}`, exact: true });
}

/** A click on the label of a pattern parameter opens its field; the value is typed, Enter. */
async function editPatternLabel(
  page: Page,
  name: string,
  value: string,
  typed: string,
): Promise<void> {
  await patternLabel(page, name, value).click();
  const field = page.getByRole('textbox', { name, exact: true });
  await expect(field).toBeFocused();
  await field.fill(typed);
  await field.press('Enter');
  await expect(field).toHaveCount(0);
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
  // described by ExportedDocument and the readers below check the arrays they rely on.
  return JSON.parse(text) as ExportedDocument;
}

/** The entities of the sketch feature. */
function entitiesOf(doc: ExportedDocument, sketch: string): readonly ExportedEntity[] {
  const found = doc.snapshot.document.studio.features.find((f) => f.name === sketch);
  if (found === undefined) throw new Error(`no feature ${sketch}`);
  // A sketch keeps its entities in the data param 'entities' (sketch model, SKETCH_PARAM).
  const entities = found.params['entities'];
  if (!Array.isArray(entities)) throw new Error(`no entities in ${sketch}`);
  // The export is the document as stored; parseSketchData checked it when it was written.
  return entities as readonly ExportedEntity[];
}

/** The entities of the kind in the sketch. */
function ofKind<K extends ExportedEntity['kind']>(
  entities: readonly ExportedEntity[],
  kind: K,
): readonly Extract<ExportedEntity, { kind: K }>[] {
  return entities.filter((e): e is Extract<ExportedEntity, { kind: K }> => e.kind === kind);
}

/** The only entity of the kind in the sketch. */
function only<K extends ExportedEntity['kind']>(
  entities: readonly ExportedEntity[],
  kind: K,
): Extract<ExportedEntity, { kind: K }> {
  const found = ofKind(entities, kind);
  expect(found).toHaveLength(1);
  const [first] = found;
  if (first === undefined) throw new Error(`no ${kind}`);
  return first;
}

test('a line mirrored across a line: the copy selects the mirror, Finish keeps it', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. The axis (vertical, x = 0) and a sloping source line left of it.
  // Each waited for: the next tool sees an entity only once the session has it, after its solve
  // (as in m29). The axis is vertical (3), the source has no alignment (4).
  const status = panel.getByRole('status');
  await drawLine(page, [0, -120], [0, 120]);
  await expect(status).toHaveText('Stupně volnosti: 3');
  const sourceFrom = [-160, -60] as const;
  const sourceTo = [-60, 50] as const;
  await drawLine(page, sourceFrom, sourceTo);
  await expect(status).toHaveText('Stupně volnosti: 7');

  // 2. Mirror: a click on the source picks it, Enter, a click on the axis writes the mirror.
  await toolbarButton(page, 'Zrcadlit').click();
  await clickAt(page, [-110, -5]);
  await page.keyboard.press('Enter');
  await clickAt(page, [0, -80]);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. Finish kept the mirror in the document: the source line across the axis line.
  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const lines = ofKind(entities, 'line');
  expect(lines).toHaveLength(2);
  const mirror = only(entities, 'mirror');
  expect(mirror.sources).toHaveLength(1);
  expect(lines.map((l) => l.id).sort()).toEqual([mirror.axis, ...mirror.sources].sort());

  // 4. Into the sketch again: a click on the middle of the copy (mirrored across x = 0, where no
  // entity of the data lies) selects the mirror, Delete deletes it; the lines stay.
  await timelineFeature(page, 'Skica 1').dblclick();
  const reopened = sketchPanel(page, 'Skica 1');
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole('status')).toHaveText('Stupně volnosti: 7');
  await clickAt(page, [-(sourceFrom[0] + sourceTo[0]) / 2, (sourceFrom[1] + sourceTo[1]) / 2]);
  await page.keyboard.press('Delete');
  await finishSketch(reopened);
  const after = entitiesOf(await exportDocument(page), 'Skica 1');
  expect(ofKind(after, 'mirror')).toHaveLength(0);
  expect(ofKind(after, 'line')).toHaveLength(2);
});

test('a linear pattern of a circle grows into the second direction by its label 1×', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. A circle of radius 20 px: its width along x is 40 px, so the new pattern has the spacing
  // 60 px along +x and three instances (spec 12, "Nástroje").
  const centre = [-150, 80] as const;
  const radius = 20;
  const spacing = 3 * radius;
  await drawCircle(page, centre, radius);
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 3');

  // 2. Linear pattern: a click on the circle picks it, Enter writes the pattern and selects it,
  // so its labels show: the count 3× of direction 1 and 1× of direction 2.
  await pickVariant(page, 'Zrcadlit', 'Lineární pole');
  await clickAt(page, [centre[0], centre[1] - radius]);
  await page.keyboard.press('Enter');
  await expect(patternLabel(page, 'Počet', '3×')).toBeVisible();
  await expect(patternLabel(page, 'Počet', '1×')).toBeVisible();

  // 3. The label 1× set to 2 adds direction 2 (perpendicular, the same spacing): 3 × 2 instances.
  await editPatternLabel(page, 'Počet', '1×', '2');
  await expect(patternLabel(page, 'Počet', '2×')).toBeVisible();
  await expect(patternLabel(page, 'Počet', '1×')).toHaveCount(0);

  // 4. Escape back to the select tool and to no selection; the labels go. A click on the far
  // copy (instance 2-1: two spacings along +x, one along direction 2, at +90° in the plane =
  // up on the screen) selects the pattern again.
  await leaveTool(page);
  await expect(patternLabel(page, 'Počet', '3×')).toHaveCount(0);
  await clickAt(page, [centre[0] + 2 * spacing, centre[1] - spacing - radius]);
  await expect(patternLabel(page, 'Počet', '3×')).toBeVisible();
  await expect(patternLabel(page, 'Počet', '2×')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const pattern = only(entities, 'linearPattern');
  expect(pattern.sources).toEqual([only(entities, 'circle').id]);
  expect(pattern.direction1.count).toBe(3);
  expect(pattern.direction1.angle).toBe(0);
  expect(pattern.direction2?.count).toBe(2);
  expect(pattern.direction2?.angle).toBeCloseTo(Math.PI / 2, 9);
  expect(pattern.direction2?.spacing).toBeCloseTo(pattern.direction1.spacing, 9);
});

test('a circular pattern of a circle around the end of a line: four instances', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. A line whose upper end is the centre (4 degrees of freedom), and a circle of radius 20 px
  // at (100, 30) px from it, aligned with no point (3 more).
  const status = panel.getByRole('status');
  const pivot = [-40, 20] as const;
  await drawLine(page, pivot, [-140, 120]);
  await expect(status).toHaveText('Stupně volnosti: 4');
  const centre = [pivot[0] + 100, pivot[1] + 30] as const;
  const radius = 20;
  await drawCircle(page, centre, radius);
  await expect(status).toHaveText('Stupně volnosti: 7');

  // 2. Circular pattern: a click on the circle picks it, Enter, a click on the end of the line
  // writes the pattern (four instances over the full circle) and selects it.
  await pickVariant(page, 'Zrcadlit', 'Kruhové pole');
  await clickAt(page, [centre[0], centre[1] - radius]);
  await page.keyboard.press('Enter');
  await clickAt(page, pivot);
  await expect(patternLabel(page, 'Počet', '4×')).toBeVisible();
  await expect(patternLabel(page, 'Úhel', '360°')).toBeVisible();

  // 3. With no selection, a click on the copy turned by 90° counter-clockwise in the plane
  // selects the pattern again: (100, 30) px on the screen is (100, −30) in the plane, turned
  // (30, 100), on the screen (30, −100) from the pivot.
  await leaveTool(page);
  await expect(patternLabel(page, 'Počet', '4×')).toHaveCount(0);
  await clickAt(page, [pivot[0] + 30, pivot[1] - 100 - radius]);
  await expect(patternLabel(page, 'Počet', '4×')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const pattern = only(entities, 'circularPattern');
  expect(pattern.sources).toEqual([only(entities, 'circle').id]);
  expect(pattern.count).toBe(4);
  expect(pattern.angle).toBeCloseTo(2 * Math.PI, 9);
  const line = only(entities, 'line');
  expect(entities.some((e) => e.kind === 'point' && e.id === pattern.center)).toBe(true);
  expect(pattern.center).not.toBe(line.id);
});

test('the count of a linear pattern changed by its label, kept after a reload', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);

  // 1. A circle of radius 15 px (spacing 45 px) and a linear pattern of it: three instances.
  const centre = [-180, 0] as const;
  const radius = 15;
  const spacing = 3 * radius;
  await drawCircle(page, centre, radius);
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 3');
  await pickVariant(page, 'Zrcadlit', 'Lineární pole');
  await clickAt(page, [centre[0], centre[1] - radius]);
  await page.keyboard.press('Enter');
  await expect(patternLabel(page, 'Počet', '3×')).toBeVisible();

  // 2. The count 3 → 5 by the label in the view.
  await editPatternLabel(page, 'Počet', '3×', '5');
  await expect(patternLabel(page, 'Počet', '5×')).toBeVisible();

  // 3. The copies follow: with no selection, a click on the fifth instance (four spacings along
  // +x, where there was nothing before) selects the pattern.
  await leaveTool(page);
  await expect(patternLabel(page, 'Počet', '5×')).toHaveCount(0);
  await clickAt(page, [centre[0] + 4 * spacing, centre[1] - radius]);
  await expect(patternLabel(page, 'Počet', '5×')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 4. Reload, into the sketch: a click on the fifth instance selects the pattern with count 5,
  // and the stored recipe has it.
  await reloadWhenSaved(page);
  await timelineFeature(page, 'Skica 1').dblclick();
  const reopened = sketchPanel(page, 'Skica 1');
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole('status')).toHaveText('Stupně volnosti: 3');
  await clickAt(page, [centre[0] + 4 * spacing, centre[1] - radius]);
  await expect(patternLabel(page, 'Počet', '5×')).toBeVisible();
  await finishSketch(reopened);

  const pattern = only(entitiesOf(await exportDocument(page), 'Skica 1'), 'linearPattern');
  expect(pattern.direction1.count).toBe(5);
  expect(pattern.direction2).toBeUndefined();
});
