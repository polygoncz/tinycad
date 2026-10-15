import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  createDocument,
  dimensionInput,
  dimensionValue,
  reloadWhenSaved,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenarios of M28 (Ú6; spec 12, "Kóty (M28)") with OCCT and planegcs in the browser, in
// Czech: the dimension tool hangs the dimension of a sloping line on the cursor and the place of
// the cursor picks its kind (above the line, off the band across it → horizontal; beside it →
// vertical); a click writes it and focuses its field. A label dragged with the mouse moves, a click
// without a drag selects it, and the dragged place survives Finish and a reload. A document from
// before M28 (dimensions without placement) opens with its dimensions drawn at the default place.

/** The ends of the sloping line, px from the canvas centre (screen y down). */
const LINE_FROM = [-120, 60] as const;
const LINE_TO = [80, -20] as const;
/** A point of the line a quarter of the way from LINE_FROM, far from both ends. */
const ON_LINE = [-70, 40] as const;
/**
 * Above the line and past the band across it (its projection onto the line lies beyond LINE_TO),
 * |Δy| > |Δx| from the middle of the line → the horizontal distance.
 */
const ABOVE = [60, -130] as const;
/** Left of the line, past the band across it, |Δx| > |Δy| → the vertical distance. */
const BESIDE = [-220, 20] as const;
/** Where the horizontal label is dragged to, px from its place. */
const DRAG_BY = [50, -40] as const;
/** How far (px) a label may land from the expected place. */
const PX_TOLERANCE = 3;

/** The label of a dimension in the view, named by its rounded value. */
function viewLabel(page: Page, text: string): Locator {
  return page.getByRole('button', { name: text, exact: true });
}

/** The centre of an element on the page, px. */
async function centre(locator: Locator): Promise<readonly [number, number]> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element is not visible');
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** The distance of two points, px. */
function apart(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * A new sketch on the XY plane with one sloping line, not snapped to the grid (Alt held, M19.2
 * D4), so its ends lie under the clicks. Returns the panel of the open sketch.
 */
async function sketchWithSlopingLine(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await toolbarButton(page, 'Úsečka').click();
  await page.keyboard.down('Alt');
  await clickCanvas(page, ...LINE_FROM);
  await clickCanvas(page, ...LINE_TO);
  await page.keyboard.up('Alt');
  // Two free points: four degrees of freedom.
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 4');
  return panel;
}

/** Dimension tool → a click on the line → the dimension hangs → a click at `at` writes it. */
async function dimensionLineAt(page: Page, at: readonly [number, number]): Promise<void> {
  await toolbarButton(page, 'Kóta').click();
  await clickCanvas(page, ...ON_LINE);
  await clickCanvas(page, ...at);
}

test('a horizontal dimension placed with the mouse, dragged, kept after a reload', async ({
  page,
}) => {
  const panel = await sketchWithSlopingLine(page);

  // 1. Above the line, off the band across it: the horizontal distance; its field gets the focus
  // and the label stands in the view.
  await dimensionLineAt(page, ABOVE);
  const horizontal = dimensionInput(panel, 'Vodorovná vzdálenost 1');
  await expect(horizontal).toBeFocused();
  const shown = await horizontal.inputValue();
  const label = viewLabel(page, shown);
  await expect(label).toBeVisible();

  // Beside the line: the vertical distance of the same line. The line runs 200 px across and
  // 80 px up, so Δx / Δy = 2.5 tells the horizontal distance measures Δx.
  await dimensionLineAt(page, BESIDE);
  const vertical = dimensionInput(panel, 'Svislá vzdálenost 1');
  await expect(vertical).toBeFocused();
  const dx = await dimensionValue(horizontal);
  const dy = await dimensionValue(vertical);
  expect(dx / dy).toBeCloseTo(200 / 80, 1);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // 2. A drag of the label moves it with the pointer; the value stays.
  const before = await centre(label);
  const target = [before[0] + DRAG_BY[0], before[1] + DRAG_BY[1]] as const;
  await page.mouse.move(...before);
  await page.mouse.down();
  await page.mouse.move(...target, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => apart(await centre(label), target)).toBeLessThan(PX_TOLERANCE);
  await expect(horizontal).toHaveValue(shown);
  // The drag did not select it; a click without a drag does.
  await expect(label).toHaveAttribute('aria-pressed', 'false');
  await label.click();
  await expect(label).toHaveAttribute('aria-pressed', 'true');
  const dragged = await centre(label);

  // 3. Finish, reload, open the sketch again: the camera looks along the normal of the plane as
  // before, and the label stands where it was dragged.
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await reloadWhenSaved(page);
  await timelineFeature(page, 'Skica 1').dblclick();
  const reopened = sketchPanel(page, 'Skica 1');
  await expect(dimensionInput(reopened, 'Vodorovná vzdálenost 1')).toHaveValue(shown);
  const reloaded = viewLabel(page, shown);
  await expect(reloaded).toBeVisible();
  await expect.poll(async () => apart(await centre(reloaded), dragged)).toBeLessThan(PX_TOLERANCE);
});

test('a document from before M28: dimensions without placement are drawn', async ({
  page,
}, testInfo) => {
  const panel = await sketchWithSlopingLine(page);
  await dimensionLineAt(page, ABOVE);
  const shown = await dimensionInput(panel, 'Vodorovná vzdálenost 1').inputValue();
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // File → Export document; the file without every placement is a document of M19.2.
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Exportovat dokument', exact: true })
    .click();
  const exported = await readFile(await (await downloading).path(), 'utf8');
  expect(exported).toContain('"placement"');
  const old = JSON.stringify(JSON.parse(exported), (key, value: unknown) =>
    key === 'placement' ? undefined : value,
  );
  expect(old).not.toContain('"placement"');
  const oldPath = testInfo.outputPath('before-m28.tinycad.json');
  await writeFile(oldPath, old, 'utf8');

  // Back to the documents → Import: the new document opens; the sketch opens with its dimension
  // drawn at the default place.
  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importovat', exact: true }).click();
  await (await choosing).setFiles(oldPath);
  await expect(page).toHaveURL(/#\/d\//);
  await expect(page.getByText(/Chyby: /)).toHaveCount(0);

  await timelineFeature(page, 'Skica 1').dblclick();
  const opened = sketchPanel(page, 'Skica 1');
  await expect(dimensionInput(opened, 'Vodorovná vzdálenost 1')).toHaveValue(shown);
  await expect(viewLabel(page, shown)).toBeVisible();
  await expect(opened.getByRole('alert')).toHaveCount(0);
});
