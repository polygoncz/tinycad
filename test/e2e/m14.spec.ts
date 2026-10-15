import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  expectNoErrors,
  fillParam,
  isoCanvasOffset,
  openTool,
  refField,
  reloadWhenSaved,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenario of M14 (Ú15) with OCCT in the browser, in Czech: a fillet on an edge of a box
// picked in the viewport survives a change of the box height (spec 08, scenario 1), undo and a
// reload. The edge is clicked at coordinates computed from the first view of the document (iso,
// fitted on the box), no hook into the page.

/** The default box of the box feature (box schema defaults): 10 × 10 × 10 mm at the origin. */
const BOX_MIN = [0, 0, 0] as const;
const BOX_MAX = [10, 10, 10] as const;
/** The middle of the top front edge (y = 0, z = 10): the iso view sees its front and top face. */
const TOP_FRONT_EDGE_MIDDLE = [5, 0, 10] as const;

/** The feature in the Timeline has no error (its description carries the state). */
async function expectFeatureOk(item: Locator): Promise<void> {
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAccessibleDescription(/Chyba/);
}

test('fillet an edge picked in the viewport, change the box height, undo, reload', async ({
  page,
}) => {
  await createDocument(page);

  // 1. The default box. The camera of a new document stays put (M19.2 D7), so "Zobrazit vše"
  // (F) fits it on the box for isoCanvasOffset.
  const box = await openTool(page, 'Kvádr', 'Kvádr 1');
  await confirmDialog(box);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await page.keyboard.press('f');

  // 2. Fillet: the edge field is active, a click on the top front edge picks it.
  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  const edges = refField(fillet, 'Hrany');
  await expect(edges).toHaveAttribute('aria-pressed', 'true');
  await expect(edges).toHaveText('Vybráno: 0 · vyberte v pohledu');
  const { dx, dy } = await isoCanvasOffset(page, BOX_MIN, BOX_MAX, TOP_FRONT_EDGE_MIDDLE);
  await clickCanvas(page, dx, dy);
  await expect(edges).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await confirmDialog(fillet);
  await expectFeatureOk(timelineFeature(page, 'Zaoblení 1'));
  await expectNoErrors(page);

  // 3. Twice the height: the named edge still exists, the fillet regenerates without an error.
  await timelineFeature(page, 'Kvádr 1').dblclick();
  const edited = page.getByRole('dialog', { name: 'Kvádr 1', exact: true });
  await expect(edited).toBeVisible();
  await fillParam(page, 'Výška', '20');
  await confirmDialog(edited);
  await expectNoErrors(page);
  await expectFeatureOk(timelineFeature(page, 'Kvádr 1'));
  await expectFeatureOk(timelineFeature(page, 'Zaoblení 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  // 4. Undo of the height change, then a reload: the model is back and still without an error.
  await toolbarButton(page, 'Zpět').click();
  await expectNoErrors(page);
  await expectFeatureOk(timelineFeature(page, 'Zaoblení 1'));

  await reloadWhenSaved(page);
  for (const name of ['Kvádr 1', 'Zaoblení 1']) {
    await expectFeatureOk(timelineFeature(page, name));
  }
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);
  // 5. The console stays clean (fixtures).
});
