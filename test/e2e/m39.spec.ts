import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  createDocument,
  drawDimensionedRectangle,
  expectNoErrors,
  openConstraintSection,
  pickVariant,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The sketcher's 2D geometry through the native core (M39; since M46 the only path, N68): trim
// and offset ask GeometryService of tinycad-core over gRPC-Web (the preview server forwards /api
// to Envoy). Each test records the calls of GeometryService the page makes and checks they
// happened and succeeded: the result in the sketch comes from the server.

/** The path prefix of GeometryService calls (gRPC-Web: /<package>.<service>/<method>). */
const GEOMETRY_SERVICE = '/api/tinycad.v1.GeometryService/';

/** A finished call of GeometryService: the method, the HTTP status and the header grpc-status. */
interface GeometryCall {
  readonly method: string;
  readonly status: number;
  /** Set only on a trailers-only answer (an error); a success sends it in the body trailers. */
  readonly grpcStatus: string | undefined;
}

/** Records every answered call of GeometryService the page makes, from now on. */
function recordGeometryCalls(page: Page): readonly GeometryCall[] {
  const calls: GeometryCall[] = [];
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    if (!pathname.startsWith(GEOMETRY_SERVICE)) return;
    calls.push({
      method: pathname.slice(GEOMETRY_SERVICE.length),
      status: response.status(),
      grpcStatus: response.headers()['grpc-status'],
    });
  });
  return calls;
}

/** The calls of the method succeeded at least once, and none of them failed. */
function expectSucceeded(calls: readonly GeometryCall[], method: string): void {
  const own = calls.filter((c) => c.method === method);
  expect(own.length, `calls of ${method}`).toBeGreaterThan(0);
  for (const call of own) {
    expect(call.status).toBe(200);
    expect(call.grpcStatus ?? '0').toBe('0');
  }
}

/** The parts of an exported document the tests read (persistence TinycadFile, spec 05). */
interface ExportedDocument {
  readonly snapshot: {
    readonly document: {
      readonly studio: {
        readonly features: readonly {
          readonly name: string;
          readonly params: Readonly<Record<string, unknown>>;
        }[];
      };
    };
  };
}

/** The sketch entities the tests read (sketch model). */
type ExportedEntity =
  | { readonly kind: 'point'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly id: string; readonly p1: string; readonly p2: string }
  | { readonly kind: 'circle' | 'arc' | 'bspline' | 'fitSpline'; readonly id: string };

/** The sketch constraints the tests read (sketch model). */
interface ExportedConstraint {
  readonly kind: string;
  readonly value?: number;
  readonly pairs?: readonly { readonly source: string; readonly copy: string }[];
}

/** File → Export document; the entities and constraints of Skica 1. */
async function sketchData(page: Page): Promise<{
  readonly entities: readonly ExportedEntity[];
  readonly constraints: readonly ExportedConstraint[];
}> {
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
  const { entities, constraints } = sketch?.params ?? {};
  if (!Array.isArray(entities) || !Array.isArray(constraints)) throw new Error('no Skica 1');
  // The export is the document as stored; parseSketchData checked it when it was written.
  return {
    entities: entities as readonly ExportedEntity[],
    constraints: constraints as readonly ExportedConstraint[],
  };
}

function linesOf(entities: readonly ExportedEntity[]) {
  return entities.filter((e): e is Extract<ExportedEntity, { kind: 'line' }> => e.kind === 'line');
}

/** The bounding box of the end points of the lines with the ids, mm. */
function boxOf(entities: readonly ExportedEntity[], ids: readonly string[]) {
  const pointAt = (id: string): readonly [number, number] => {
    const point = entities.find((e) => e.id === id);
    if (point?.kind !== 'point') throw new Error(`no point ${id}`);
    return [point.x, point.y];
  };
  const points = linesOf(entities)
    .filter((l) => ids.includes(l.id))
    .flatMap((l) => [pointAt(l.p1), pointAt(l.p2)]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Into a new sketch with the grid snap off and the constraint list open (as m33); the panel. */
async function openSketchWithoutGrid(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await openConstraintSection(panel);
  return panel;
}

/** Four lines, the bottom one past the first corner (m33): the overshoot to trim. */
async function drawOvershootingProfile(page: Page, status: Locator): Promise<void> {
  await toolbarButton(page, 'Úsečka').click();
  for (const [x, y] of [
    [-80, 60],
    [-80, -60],
    [80, -60],
    [80, 60],
    [-120, 60],
  ] as const) {
    await clickCanvas(page, x, y);
  }
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 5');
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

test('trim through the core: the intersections come from GeometryService', async ({ page }) => {
  const calls = recordGeometryCalls(page);
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');
  await drawOvershootingProfile(page, status);

  // Trim (T) the overshoot left of the first corner. The tool needs the intersections of the
  // current data from the core; until they are there a click does nothing, so it is repeated
  // until the sketch changes.
  await page.keyboard.press('t');
  await expect(async () => {
    await clickCanvas(page, -100, 60);
    await expect(status).toHaveText('Stupně volnosti: 4', { timeout: 1000 });
  }).toPass();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expectSucceeded(calls, 'Intersections');
  await finishSketch(panel);
  await expectNoErrors(page);

  // The bottom ends in the first corner: four points, four lines.
  const { entities } = await sketchData(page);
  expect(entities.filter((e) => e.kind === 'point')).toHaveLength(4);
  expect(linesOf(entities)).toHaveLength(4);
});

test('offset of a rectangle through the core: the copy comes from GeometryService', async ({
  page,
}) => {
  const calls = recordGeometryCalls(page);
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');

  // Offset with a click just below the bottom edge: outwards. The copy and its dimension appear
  // only once the core has answered the offset of the chain.
  const offsetAnswered = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith(`${GEOMETRY_SERVICE}Offset`),
  );
  await pickVariant(page, 'Ořezat', 'Odsadit');
  await clickCanvas(page, 60, 2);
  await offsetAnswered;
  const offset = panel.getByRole('textbox', { name: 'Odsazení 1', exact: true });
  await expect(offset).toBeFocused();
  await expect(panel.getByRole('status')).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expectSucceeded(calls, 'Offset');
  await finishSketch(panel);
  await expectNoErrors(page);

  // Four pairs, the copy around the rectangle at the offset on every side (sharp corners).
  const { entities, constraints } = await sketchData(page);
  const constraint = constraints.find((c) => c.kind === 'offset');
  if (constraint?.pairs === undefined || constraint.value === undefined) {
    throw new Error('no offset');
  }
  expect(constraint.pairs).toHaveLength(4);
  const d = constraint.value;
  expect(d).toBeGreaterThan(0);
  const source = boxOf(
    entities,
    constraint.pairs.map((p) => p.source),
  );
  const copy = boxOf(
    entities,
    constraint.pairs.map((p) => p.copy),
  );
  expect(copy.x0).toBeCloseTo(source.x0 - d, 6);
  expect(copy.y0).toBeCloseTo(source.y0 - d, 6);
  expect(copy.x1).toBeCloseTo(source.x1 + d, 6);
  expect(copy.y1).toBeCloseTo(source.y1 + d, 6);
});

test('a failing core: trim does nothing, the sketch stays usable', async ({ page }) => {
  // The core answers every Intersections call with UNAVAILABLE (a trailers-only gRPC-Web answer,
  // HTTP 200, so the browser logs no failed request). The sketcher treats it like no answer yet
  // (sketch-session requestHits): no crossing points, a trim click does nothing, no error shown.
  await page.route(`**${GEOMETRY_SERVICE}Intersections`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/grpc-web+proto',
        'grpc-status': '14',
        'grpc-message': 'unavailable',
      },
      body: '',
    }),
  );
  const calls = recordGeometryCalls(page);
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');
  await drawOvershootingProfile(page, status);
  await expect
    .poll(() => calls.filter((c) => c.method === 'Intersections').length)
    .toBeGreaterThan(0);
  expect(calls.every((c) => c.grpcStatus === '14')).toBe(true);

  await page.keyboard.press('t');
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, -100, 60);
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // Nothing was trimmed: still five points and four lines.
  const { entities } = await sketchData(page);
  expect(entities.filter((e) => e.kind === 'point')).toHaveLength(5);
  expect(linesOf(entities)).toHaveLength(4);
});
