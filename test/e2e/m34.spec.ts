import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  dimensionValue,
  drawDimensionedRectangle,
  expectNoErrors,
  openTool,
  refField,
  toolbarButton,
  variantsButton,
} from './helpers';

// The scenarios of M34 (spec 12, "Zaoblení a sražení ve skice (M34)") with OCCT and planegcs in
// the browser, in Czech: a corner of the fully defined rectangle of drawDimensionedRectangle is
// filleted (a tangent arc, its radius dimension opens and changes, the corner keeps its
// dimension) or chamfered, and the profile extrudes. The data are read from the exported document
// (File → Export document).

// The sketcher toolbar with the group Upravit (M33, M34) needs 1500 px to show the group Vazby
// (the dimension tool of drawDimensionedRectangle) outside the menu "…".
test.use({ viewport: { width: 1600, height: 720 } });

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
  readonly point?: string;
  readonly curve?: string;
  readonly a?: string;
  readonly b?: string;
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

/** Opens the menu of the variants of the family showing `shown` and picks exactly `variant`. */
async function pickExactVariant(page: Page, shown: string, variant: string): Promise<void> {
  await variantsButton(page, shown).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: variant, exact: true }).click();
  await expect(menu).toBeHidden();
}

/** The point of the pointOnCurve constraints to both curves: the virtual sharp corner. */
function virtualCorner(constraints: readonly ExportedConstraint[]): string {
  const on = constraints.filter((c) => c.kind === 'pointOnCurve').map((c) => c.point);
  const corner = on.find((p, i) => p !== undefined && on.indexOf(p) !== i);
  if (corner === undefined) throw new Error('no virtual corner');
  return corner;
}

/** The rectangle profile extrudes into one body. */
async function extrudeOneRegion(page: Page): Promise<void> {
  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  await expect(refField(extrude, 'Oblasti')).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);
}

test('a filleted corner: a tangent arc, its radius changes, the corner stays dimensioned', async ({
  page,
}) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  const status = panel.getByRole('status');

  // 1. Fillet the top right corner (the end of the dimension of the right edge, screen y down):
  // the radius dimension opens with the focus, the sketch stays fully defined.
  await toolbarButton(page, 'Zaoblit').click();
  await clickCanvas(page, 120, -80);
  const radius = panel.getByRole('textbox', { name: 'Poloměr 1', exact: true });
  await expect(radius).toBeFocused();
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 2. Half the radius: solved again, still fully defined.
  const first = await dimensionValue(radius);
  expect(first).toBeGreaterThan(0);
  await radius.fill(String(first / 2));
  await radius.press('Enter');
  await expect.poll(async () => dimensionValue(radius)).toBeCloseTo(first / 2, 6);
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. The arc is tangent to both edges of the corner (its centre r inside both), the corner stays
  // as a point on both edges and keeps the dimension of the right edge.
  const { entities, constraints } = await sketchData(page);
  const [arc] = ofKind(entities, 'arc');
  if (arc === undefined) throw new Error('no arc');
  const r = constraints.find((c) => c.kind === 'radius')?.value;
  expect(r).toBeCloseTo(first / 2, 6);
  const corner = virtualCorner(constraints);
  const [cx, cy] = pointAt(entities, corner);
  const center = pointAt(entities, arc.center);
  expect(Math.abs(cx - center[0])).toBeCloseTo(r ?? NaN, 6);
  expect(Math.abs(cy - center[1])).toBeCloseTo(r ?? NaN, 6);
  for (const end of [arc.start, arc.end]) {
    const p = pointAt(entities, end);
    expect(Math.hypot(p[0] - center[0], p[1] - center[1])).toBeCloseTo(r ?? NaN, 6);
  }
  expect(
    constraints.some(
      (c) => c.kind !== 'pointOnCurve' && c.kind !== 'radius' && (c.a === corner || c.b === corner),
    ),
  ).toBe(true);

  // 4. The rounded rectangle is one region and extrudes.
  await extrudeOneRegion(page);
});

test('chamfered corners: two distances and distance with an angle, then an extrude', async ({
  page,
}) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  const status = panel.getByRole('status');

  // 1. Chamfer the top right corner with two equal distances: the first one opens.
  await pickExactVariant(page, 'Zaoblit', 'Srazit');
  await clickCanvas(page, 120, -80);
  await expect(panel.getByRole('textbox', { name: 'Vzdálenost 1', exact: true })).toBeFocused();
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 2. Chamfer the top left corner with a distance and an angle of 45°.
  await pickExactVariant(page, 'Srazit', 'Srazit s úhlem');
  await clickCanvas(page, 0, -80);
  await expect(panel.getByRole('textbox', { name: 'Úhel 1', exact: true })).toBeVisible();
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. Two chamfer lines among the six: the four sides and the two chamfers.
  const { entities, constraints } = await sketchData(page);
  expect(ofKind(entities, 'line')).toHaveLength(6);
  const angle = constraints.find((c) => c.kind === 'angle')?.value;
  expect(angle).toBeCloseTo(Math.PI / 4, 6);

  await extrudeOneRegion(page);
});
