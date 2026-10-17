import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  editFeatureWithInput,
  expectNoErrors,
  fillParam,
  isoCanvasOffset,
  openTool,
  refField,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenarios of M21 (Ú7, ADR 0025) with OCCT and planegcs in the browser, in Czech: while a
// feature is edited, the pickable model is its input. A fillet being edited picks edges of the
// box before the fillet; a sketch on a face opens on the plane its builder computed from its input
// even after a later transform and a boolean that consumes the body; the field "Rovina" of the
// sketch panel moves an existing sketch onto another origin plane. Clicks go to coordinates
// computed from the first view of the document (iso, fitted on the box), no hook into the page.

/** The default box of the box feature (box schema defaults): 10 × 10 × 10 mm at the origin. */
const BOX_MIN = [0, 0, 0] as const;
const BOX_MAX = [10, 10, 10] as const;
/** The middle of the top front edge (y = 0, z = 10): the iso view sees its front and top face. */
const TOP_FRONT_EDGE_MIDDLE = [5, 0, 10] as const;
/** The middle of the top right edge (x = 10, z = 10): the iso view sees its right and top face. */
const TOP_RIGHT_EDGE_MIDDLE = [10, 5, 10] as const;
/**
 * The radius of the fillet: its tangent edge with the top face lies this far from the original
 * edge, in the default view about 100 px, far beyond the 8 px tolerance of picking edges.
 */
const FILLET_RADIUS = 3;
/** The middle of the tangent edge of the fillet and the top face (y = radius, z = 10). */
const TOP_TANGENT_EDGE_MIDDLE = [5, FILLET_RADIUS, 10] as const;
/** The middle of the top face. */
const TOP_FACE_MIDDLE = [5, 5, 10] as const;

/**
 * A row of the Browser, named by its displayed text ("Těleso 1", "Přední (XZ)").
 * A body row is clicked on its name: the click hovers the row, which shows its colour and
 * material controls (spec 11), and the middle of the row may then fall on them; they keep the
 * click.
 */
function browserRow(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

/** The feature in the Timeline has no error (its description carries the state). */
async function expectFeatureOk(item: Locator): Promise<void> {
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAccessibleDescription(/Chyba/);
}

/** The default box, then "Zobrazit vše" (F) fits the camera on it for isoCanvasOffset. */
async function addFittedBox(page: Page): Promise<void> {
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await page.keyboard.press('f');
}

/** Clicks the model point in the iso view fitted on the default box. */
async function clickBoxPoint(page: Page, point: readonly [number, number, number]): Promise<void> {
  const { dx, dy } = await isoCanvasOffset(page, BOX_MIN, BOX_MAX, point);
  await clickCanvas(page, dx, dy);
}

/** The field "Rovina" of the sketch panel: its accessible name is the label and the plane. */
function planeField(panel: Locator): Locator {
  return panel.getByRole('button', { name: /^Rovina / });
}

test('editing a fillet picks the edges of its input: a second edge, no error', async ({ page }) => {
  await createDocument(page);
  await addFittedBox(page);

  // 1. A fillet of the top front edge.
  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  const edges = refField(fillet, 'Hrany');
  await expect(edges).toHaveAttribute('aria-pressed', 'true');
  await clickBoxPoint(page, TOP_FRONT_EDGE_MIDDLE);
  await expect(edges).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await fillParam(page, 'Poloměr', String(FILLET_RADIUS));
  await confirmDialog(fillet);
  await expectFeatureOk(timelineFeature(page, 'Zaoblení 1'));
  await expectNoErrors(page);

  // 2. Edit: the picked edge is still a chip of the dialog (in the input it exists, so its name
  // resolves and it is highlighted; the highlight itself is checked by the unit tests).
  const edited = await editFeatureWithInput(page, 'Zaoblení 1');
  const editedEdges = refField(edited, 'Hrany');
  await expect(editedEdges).toContainText('Vybráno: 1');
  await expect(edited.getByRole('button', { name: 'Odebrat Hrana 1', exact: true })).toBeVisible();
  await expect(edited.getByRole('button', { name: 'Odebrat Hrana 2', exact: true })).toHaveCount(0);

  // An edited dialog activates no field by itself: a click on the field does.
  await expect(editedEdges).toHaveAttribute('aria-pressed', 'false');
  await editedEdges.click();
  await expect(editedEdges).toHaveAttribute('aria-pressed', 'true');

  // 3. A click where the fillet has its tangent edge with the top face. The pickable model is the
  // box before the fillet (ADR 0025): there is only the top face, so the edge field takes nothing.
  // Before M21 the view showed the filleted box and the click picked that edge of the fillet's
  // own output, so the fillet failed with an unresolved reference.
  await clickBoxPoint(page, TOP_TANGENT_EDGE_MIDDLE);
  // A click on the top right edge, which exists in the input, adds the second reference; its
  // count also shows that the click before it added nothing.
  await clickBoxPoint(page, TOP_RIGHT_EDGE_MIDDLE);
  await expect(editedEdges).toHaveText('Vybráno: 2 · vyberte v pohledu');
  await expect(edited.getByRole('button', { name: 'Odebrat Hrana 2', exact: true })).toBeVisible();
  await expect(edited.getByRole('button', { name: 'Odebrat Hrana 3', exact: true })).toHaveCount(0);
  await confirmDialog(edited);

  // 4. The fillet of two edges regenerates without an error.
  await expectFeatureOk(timelineFeature(page, 'Zaoblení 1'));
  await expectFeatureOk(timelineFeature(page, 'Kvádr 1'));
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  // 5. The console stays clean (fixtures).
});

test('a sketch on a face opens after a transform and a boolean that consumes the body', async ({
  page,
}) => {
  await createDocument(page);
  await addFittedBox(page);

  // 1. The top face selected in the view → Skica: a sketch on that face. The camera of the
  // sketch looks at the face, fitted on the box, so a circle around the middle of the canvas lies
  // on the face.
  await clickBoxPoint(page, TOP_FACE_MIDDLE);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await toolbarButton(page, 'Kružnice').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 20, 0);
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));
  await expectNoErrors(page);

  // 2. The box moved by 20 mm in x.
  const transform = await openTool(page, 'Transformace', 'Transformace 1');
  const bodies = refField(transform, 'Tělesa');
  await expect(bodies).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Těleso 1').getByText('Těleso 1', { exact: true }).click();
  await expect(
    transform.getByRole('button', { name: 'Odebrat Kvádr 1', exact: true }),
  ).toBeVisible();
  await fillParam(page, 'Posun X', '20');
  await confirmDialog(transform);
  await expectFeatureOk(timelineFeature(page, 'Transformace 1'));
  await expectNoErrors(page);

  // 3. A cylinder through the moved box, then a union with the cylinder as the target and the box
  // as the tool: the box body is consumed, one body stays.
  const cylinder = await openTool(page, 'Válec', 'Válec 1');
  await fillParam(page, 'Střed podstavy X', '25');
  await fillParam(page, 'Střed podstavy Y', '5');
  await fillParam(page, 'Střed podstavy Z', '-1');
  await fillParam(page, 'Poloměr', '2');
  await fillParam(page, 'Výška', '12');
  await confirmDialog(cylinder);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();

  const boolean = await openTool(page, 'Boolean', 'Boolean 1');
  const targets = refField(boolean, 'Cíle');
  const tools = refField(boolean, 'Nástroje');
  await expect(targets).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Těleso 2').getByText('Těleso 2', { exact: true }).click();
  await tools.click();
  await expect(tools).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Těleso 1').getByText('Těleso 1', { exact: true }).click();
  await expect(boolean.getByRole('button', { name: 'Odebrat Válec 1', exact: true })).toBeVisible();
  await expect(boolean.getByRole('button', { name: 'Odebrat Kvádr 1', exact: true })).toBeVisible();
  await boolean
    .getByRole('combobox', { name: 'Operace', exact: true })
    .selectOption({ label: 'Sjednocení' });
  await confirmDialog(boolean);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectFeatureOk(timelineFeature(page, 'Boolean 1'));
  await expectNoErrors(page);

  // 4. The sketch opens from the Timeline on the plane from its input, without an error.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited).toBeVisible();
  await expect(edited.getByRole('alert')).toHaveCount(0);
  await expect(toolbarButton(page, 'Kružnice')).toBeVisible();
  await expectNoErrors(page);
  // The field "Rovina" (new in M21) names the face the sketch is on.
  await expect(planeField(edited)).toHaveText(/^Plocha tělesa /);
  await edited.getByRole('button', { name: 'Zrušit skicu', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));
  await expectNoErrors(page);
  // 5. The console stays clean (fixtures).
});

test('the field "Rovina" moves an existing sketch onto another origin plane', async ({ page }) => {
  await createDocument(page);

  // 1. A circle sketch on the default plane (Horní, XY) → Finish.
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await expect(planeField(panel)).toHaveText('Horní (XY)');
  await toolbarButton(page, 'Kružnice').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 40, 0);
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));

  // 2. Edit, the field "Rovina" starts picking a plane; the row of the front plane in the Browser
  // (the origin folder is collapsed by default) moves the sketch and ends picking.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited).toBeVisible();
  const plane = planeField(edited);
  await expect(plane).toHaveText('Horní (XY)');
  await expect(plane).toHaveAttribute('aria-pressed', 'false');
  await plane.click();
  await expect(plane).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Počátek').click();
  await browserRow(page, 'Přední (XZ)').click();
  await expect(plane).toHaveText('Přední (XZ)');
  await expect(plane).toHaveAttribute('aria-pressed', 'false');
  await expect(edited.getByRole('alert')).toHaveCount(0);

  // 3. Finish: the sketch stays without an error; opened again, it is on the front plane.
  await edited.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));
  await expectNoErrors(page);
  await timelineFeature(page, 'Skica 1').dblclick();
  const reopened = sketchPanel(page, 'Skica 1');
  await expect(planeField(reopened)).toHaveText('Přední (XZ)');
  await reopened.getByRole('button', { name: 'Zrušit skicu', exact: true }).click();
  await expect(reopened).toHaveCount(0);
  await expectNoErrors(page);
  // 4. The console stays clean (fixtures).
});

test('a sketch whose face is gone opens on XY, asks for a plane and takes an origin plane', async ({
  page,
}) => {
  await createDocument(page);
  await addFittedBox(page);

  // 1. A circle sketch on the top face of the box.
  await clickBoxPoint(page, TOP_FACE_MIDDLE);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await toolbarButton(page, 'Kružnice').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 20, 0);
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));

  // 2. The box before the sketch is suppressed: its body and the top face are gone, the sketch
  // has neither an artifact nor a plane its reference resolves to (Q079).
  await timelineFeature(page, 'Kvádr 1').click({ button: 'right' });
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Potlačit( |$)/ })
    .click();
  await expect(page.getByText('Tělesa: 0')).toBeVisible();
  await expect(timelineFeature(page, 'Skica 1')).toHaveAccessibleDescription(/Chyba/);

  // 3. The sketch opens anyway: the panel asks for a new plane and picking it is active.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited).toBeVisible();
  const alert = edited.getByRole('alert');
  await expect(alert).toHaveText('Rovina skici chybí, vyberte novou');
  const plane = planeField(edited);
  await expect(plane).toHaveAttribute('aria-pressed', 'true');

  // 4. The top origin plane from the Browser: the message goes, picking ends.
  await browserRow(page, 'Počátek').click();
  await browserRow(page, 'Horní (XY)').click();
  await expect(plane).toHaveText('Horní (XY)');
  await expect(plane).toHaveAttribute('aria-pressed', 'false');
  await expect(alert).toHaveCount(0);

  // 5. Finish: the sketch on the origin plane regenerates without an error.
  await edited.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expectFeatureOk(timelineFeature(page, 'Skica 1'));
  // 6. The console stays clean (fixtures).
});
