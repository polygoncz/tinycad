import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  createExtrudedBlock,
  dimensionInput,
  dimensionValue,
  delayUnaryCalls,
  dragOnCanvas,
  drawDimensionedRectangle,
  extrudeArrowGrip,
  fillParam,
  historyRows,
  holdsValue,
  openConstraintSection,
  openTool,
  paramInput,
  reloadWhenSaved,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The thin client over a slow network (M46, M52): every unary call of the core waits 150 ms before
// it leaves the browser (the stream WatchSession does not). The feature dialog holds the values the
// user entered until the server takes the last change (N164), so a drag and quick edits stay at
// the last value; everything else shows the change with the answer (N168). The whole edit is one
// entry of the log (the server merges the steps of the transaction).

const DELAY_MS = 150;

/** The number in a param field of the open dialog ('.' or ',' as the decimal mark). */
async function paramValue(page: Page, label: string): Promise<number> {
  return Number((await paramInput(page, label).inputValue()).replace(',', '.'));
}

/** The times of the requests of the page that change the document (Apply of a transaction). */
function recordChanges(page: Page): readonly number[] {
  const times: number[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/tinycad.v1.SessionService/Apply')) times.push(Date.now());
  });
  return times;
}

/**
 * The sketch has written the drag and the core confirmed it: saved, and no Apply for a second.
 * The sketcher writes a drag step once its solver answered, which in WebKit takes most of a
 * second, so the green dot alone may still be the state from before the last step.
 */
async function writesSettled(page: Page, writes: readonly number[]): Promise<void> {
  await expect
    .poll(async () => {
      const saved = await page.getByRole('status', { name: 'Uloženo' }).count();
      const last = writes.at(-1) ?? 0;
      return saved === 1 && writes.length > 0 && Date.now() - last > 1000;
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await delayUnaryCalls(page, DELAY_MS);
});

test('dragging the arrow of an extrude: the last value stays, one entry', async ({ page }) => {
  await createDocument(page);
  await createExtrudedBlock(page);
  const rows = await historyRows(page);
  await expect(rows).toHaveCount(2);

  await timelineFeature(page, 'Vysunutí 1').dblclick();
  const edit = page.getByRole('dialog', { name: 'Vysunutí 1', exact: true });
  await expect(edit).toBeVisible();
  const [x, y] = await extrudeArrowGrip(page);
  await dragOnCanvas(page, [x, y], [x, y - 80]);
  const dragged = await paramValue(page, 'Vzdálenost');
  expect(dragged).toBeGreaterThan(12);

  // The answers of the drag come in after the release: the field keeps the last value, also for
  // a second after the last answer (N164).
  await holdsValue(
    page,
    paramInput(page, 'Vzdálenost'),
    await paramInput(page, 'Vzdálenost').inputValue(),
    1000,
  );
  expect(await paramValue(page, 'Vzdálenost')).toBeCloseTo(dragged, 6);
  await confirmDialog(edit);
  await expect(rows).toHaveCount(3);

  await reloadWhenSaved(page);
  await timelineFeature(page, 'Vysunutí 1').dblclick();
  await expect(paramInput(page, 'Vzdálenost')).toBeVisible();
  expect(await paramValue(page, 'Vzdálenost')).toBeCloseTo(dragged, 6);
  await page.getByRole('dialog').getByRole('button', { name: 'Zrušit', exact: true }).click();
});

test('dragging a point in a sketch: the point stays where it was let go, one entry', async ({
  page,
}) => {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await openConstraintSection(panel);
  const status = panel.getByRole('status');

  // A rectangle from the origin to (120, −80) px: width / height = 1.5.
  await toolbarButton(page, 'Obdélník rohy').click();
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 120, -80);
  await expect(status).toHaveText('Stupně volnosti: 2');
  await page.keyboard.press('Escape');

  // Its free corner dragged to (160, −120) px: width / height = 4 / 3. Any answer of the drag
  // taken over after the release would put the corner back on the way (a ratio above 4 / 3).
  const writes = recordChanges(page);
  await dragOnCanvas(page, [120, -80], [160, -120]);
  await writesSettled(page, writes);

  // The dimensions of the bottom and the right edge take the lengths of the sketch.
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, 80, 0);
  await clickCanvas(page, 80, 40);
  await clickCanvas(page, 160, -60);
  await clickCanvas(page, 200, -60);
  await expect(status).toHaveText('Plně určeno');
  const width = await dimensionValue(await dimensionInput(panel, 'Vodorovná vzdálenost 1'));
  const height = await dimensionValue(await dimensionInput(panel, 'Svislá vzdálenost 1'));
  expect(width / height).toBeCloseTo(4 / 3, 1);
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(await historyRows(page)).toHaveCount(1);

  // The server has the same sketch.
  await reloadWhenSaved(page);
  await timelineFeature(page, 'Skica 1').dblclick();
  const edited = sketchPanel(page, 'Skica 1');
  await expect(edited.getByRole('status')).toHaveText('Plně určeno');
  expect(await dimensionValue(await dimensionInput(edited, 'Vodorovná vzdálenost 1'))).toBeCloseTo(
    width,
    6,
  );
  expect(await dimensionValue(await dimensionInput(edited, 'Svislá vzdálenost 1'))).toBeCloseTo(
    height,
    6,
  );
  await edited.getByRole('button', { name: 'Hotovo', exact: true }).click();
});

test('the extrude dialog: quick edits end at the last value, one entry', async ({ page }) => {
  await createDocument(page);
  const panel = await drawDimensionedRectangle(page, 'Skica 1');
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  // The dialog preselects the region of the last sketch of the last read model (D6 of M19.2):
  // it opens once the answer to the finished sketch is in.
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();

  const extrude = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  for (const value of ['5', '7', '9', '11', '12.5']) await fillParam(page, 'Vzdálenost', value);
  expect(await paramValue(page, 'Vzdálenost')).toBe(12.5);
  await confirmDialog(extrude);
  await expect(timelineFeature(page, 'Vysunutí 1')).toBeVisible();
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  const rows = await historyRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Vysunutí');

  await reloadWhenSaved(page);
  await timelineFeature(page, 'Vysunutí 1').dblclick();
  await expect(paramInput(page, 'Vzdálenost')).toBeVisible();
  expect(await paramValue(page, 'Vzdálenost')).toBe(12.5);
  await page.getByRole('dialog').getByRole('button', { name: 'Zrušit', exact: true }).click();
});
