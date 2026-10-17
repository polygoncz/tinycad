import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  dimensionInput,
  dimensionValue,
  drawDimensionedRectangle,
  expectNoErrors,
  openTool,
  pickVariant,
  refField,
} from './helpers';

// The scenarios of M35 (spec 12, "Offset (M35)") with OCCT and planegcs in the browser, in Czech:
// the fully defined rectangle of drawDimensionedRectangle is offset outwards (four copies held
// by one offset constraint, its dimension opens), a new value of the offset dimension moves the
// copy, and the frame between the rectangle and its copy extrudes; and an offset inwards. The
// data are read from the exported document (File → Export document).

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
  | {
      readonly kind: 'arc';
      readonly id: string;
      readonly center: string;
      readonly start: string;
      readonly end: string;
    }
  | { readonly kind: 'bspline' | 'fitSpline'; readonly id: string };

/** The sketch constraints the tests read (sketch model). */
interface ExportedConstraint {
  readonly kind: string;
  readonly id: string;
  readonly value?: number;
  readonly pairs?: readonly { readonly source: string; readonly copy: string }[];
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

/** The bounding box of the end points of the lines, mm. */
function boxOf(
  entities: readonly ExportedEntity[],
  lines: readonly Extract<ExportedEntity, { kind: 'line' }>[],
): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const points = lines.flatMap((l) => [pointAt(entities, l.p1), pointAt(entities, l.p2)]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The original rectangle and the copy of the offset: the boxes of the sources and the copies. */
function offsetBoxes(data: {
  readonly entities: readonly ExportedEntity[];
  readonly constraints: readonly ExportedConstraint[];
}) {
  const offset = data.constraints.find((c) => c.kind === 'offset');
  if (offset?.pairs === undefined) throw new Error('no offset');
  const lines = ofKind(data.entities, 'line');
  const linesOf = (ids: readonly string[]) => lines.filter((l) => ids.includes(l.id));
  return {
    value: offset.value ?? NaN,
    pairs: offset.pairs.length,
    source: boxOf(data.entities, linesOf(offset.pairs.map((p) => p.source))),
    copy: boxOf(data.entities, linesOf(offset.pairs.map((p) => p.copy))),
  };
}

/** The copy box is the source box grown by d on every side (d < 0 shrinks it). */
function expectGrown(
  source: ReturnType<typeof boxOf>,
  copy: ReturnType<typeof boxOf>,
  d: number,
): void {
  expect(copy.x0).toBeCloseTo(source.x0 - d, 6);
  expect(copy.y0).toBeCloseTo(source.y0 - d, 6);
  expect(copy.x1).toBeCloseTo(source.x1 + d, 6);
  expect(copy.y1).toBeCloseTo(source.y1 + d, 6);
}

test('an offset of the rectangle outwards: its dimension changes, the frame extrudes', async ({
  page,
}) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  const status = panel.getByRole('status');
  const width = await dimensionValue(await dimensionInput(panel, 'Vodorovná vzdálenost 1'));

  // 1. Offset (a variant of the family Úpravy, trim shown first) with a click just below the
  // bottom edge (screen y down): outside the rectangle, so outwards. The offset dimension opens,
  // the four copies are fully defined by it.
  await pickVariant(page, 'Ořezat', 'Odsadit');
  await clickCanvas(page, 60, 2);
  const offset = panel.getByRole('textbox', { name: 'Odsazení 1', exact: true });
  await expect(offset).toBeFocused();
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  const first = await dimensionValue(offset);
  expect(first).toBeGreaterThan(0);

  // 2. About a quarter of the width (whole mm, the field shows it rounded) as the new offset:
  // solved again, still fully defined.
  const d = Math.round(width / 4);
  await offset.fill(String(d));
  await offset.press('Enter');
  await expect.poll(async () => dimensionValue(offset)).toBeCloseTo(d, 6);
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. Four pairs, the copy around the rectangle at d on every side (sharp corners).
  const boxes = offsetBoxes(await sketchData(page));
  expect(boxes.pairs).toBe(4);
  expect(boxes.value).toBeCloseTo(d, 6);
  expectGrown(boxes.source, boxes.copy, d);

  // 4. Two regions (the rectangle and the frame): the frame picked in the view below the bottom
  // edge (120 px of the canvas are the width), it extrudes into one body.
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  const regions = refField(extrude, 'Oblasti');
  await expect(regions).toHaveText('Vybráno: 0 · vyberte v pohledu');
  await clickCanvas(page, 60, (120 / width) * (d / 2));
  await expect(regions).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);
});

test('an offset of the rectangle inwards', async ({ page }) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');

  // A click just above the bottom edge: inside the rectangle, so inwards.
  await pickVariant(page, 'Ořezat', 'Odsadit');
  await clickCanvas(page, 60, -2);
  const offset = panel.getByRole('textbox', { name: 'Odsazení 1', exact: true });
  await expect(offset).toBeFocused();
  await expect(panel.getByRole('status')).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  const boxes = offsetBoxes(await sketchData(page));
  expect(boxes.pairs).toBe(4);
  expectGrown(boxes.source, boxes.copy, -boxes.value);
});
