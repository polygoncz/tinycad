import { expect, test } from './fixtures';
import {
  confirmDialog,
  createDocument,
  drawDimensionedRectangle,
  expectNoErrors,
  openTool,
  refField,
  timelineFeature,
} from './helpers';

// A new feature of M19.2 (D6, revize U5) with OCCT in the browser, in Czech: a new extrude takes
// the only region of the last sketch by itself, so its body is previewed at once; and a new
// feature that only misses its references is a draft in the Timeline, not an error, while its
// dialog is open.

test('a new extrude preselects the only region and is not an error', async ({ page }) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);

  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  // The region is in the field and the field stays active, so a click adds or removes another.
  const regions = refField(extrude, 'Oblasti');
  await expect(regions).toHaveText('Vybráno: 1 · vyberte v pohledu');
  await expect(regions).toHaveAttribute('aria-pressed', 'true');
  await expect(extrude.getByText('Vyberte aspoň 1', { exact: true })).toHaveCount(0);
  // The preview body is there while the dialog is open.
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(timelineFeature(page, 'Vysunutí 1')).not.toHaveClass(/\berror\b/);
  await expectNoErrors(page);

  await confirmDialog(extrude);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectNoErrors(page);
});

test('a new feature without its references is a draft while its dialog is open', async ({
  page,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  // A new fillet without edges: the issue at the field, a neutral item, no "Chyby".
  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  await expect(fillet.getByText('Vyberte aspoň 1', { exact: true })).toBeVisible();
  const item = timelineFeature(page, 'Zaoblení 1');
  await expect(item).toHaveClass(/\bdraft\b/);
  await expect(item).toHaveAccessibleDescription(/Rozpracovaná/);
  await expectNoErrors(page);

  // Cancel removes the feature; nothing is left that is an error.
  await fillet.getByRole('button', { name: 'Zrušit', exact: true }).click();
  await expect(fillet).toBeHidden();
  await expect(item).toHaveCount(0);
  await expectNoErrors(page);
});
