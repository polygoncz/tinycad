import { expect, test } from './fixtures';
import {
  createDocument,
  dimensionInput,
  dimensionValue,
  drawDimensionedRectangle,
  reloadWhenSaved,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenario of M12 (Ú15) with OCCT and planegcs in the browser, in Czech: a sketch on the
// XY plane, a rectangle snapped onto the origin, two dimensions make it fully defined, a new
// value of a dimension is solved again; Finish writes one entry, undo/redo and a reload keep
// the sketch, a double click opens it again and Cancel goes back to modelling. The rectangle and
// its dimensions are drawn by drawDimensionedRectangle (helpers).

test('a fully defined rectangle sketch: dimensions, finish, undo, reload, edit', async ({
  page,
}) => {
  await createDocument(page);

  // 1.–3. Into the sketch mode, a rectangle from the origin, two dimensions → fully defined.
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  await expect(toolbarButton(page, 'Kvádr')).toHaveCount(0);
  const status = panel.getByRole('status');
  const width = await dimensionInput(panel, 'Vodorovná vzdálenost 1');

  // 4. A new value of the width is solved again and the sketch stays fully defined.
  const before = await dimensionValue(width);
  expect(before).toBeGreaterThan(0);
  const doubled = String(before * 2);
  await width.fill(doubled);
  await width.press('Enter');
  await expect.poll(async () => dimensionValue(width)).toBeCloseTo(before * 2, 6);
  await expect(status).toHaveText('Plně určeno');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 5. Finish: the sketch is in the Timeline without an error, the toolbar models again.
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);
  await expect(toolbarButton(page, 'Kvádr')).toBeVisible();
  await expect(toolbarButton(page, 'Úsečka')).toHaveCount(0);

  // 6. Undo removes the whole sketch (one entry in the log), redo brings it back.
  await toolbarButton(page, 'Zpět').click();
  await expect(timelineFeature(page, 'Skica 1')).toHaveCount(0);
  await toolbarButton(page, 'Znovu').click();
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();

  await reloadWhenSaved(page);
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);

  // Editing the sketch again: fully defined after the first solve; Cancel goes back.
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited.getByRole('status')).toHaveText('Plně určeno');
  await expect(toolbarButton(page, 'Kvádr')).toHaveCount(0);
  await edited.getByRole('button', { name: 'Zrušit skicu', exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expect(toolbarButton(page, 'Kvádr')).toBeVisible();
  await expect(timelineFeature(page, 'Skica 1')).toBeVisible();
});
