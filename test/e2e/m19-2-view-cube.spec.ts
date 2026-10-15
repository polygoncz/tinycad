import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { confirmDialog, createDocument, openTool } from './helpers';

// The view cube of M19.2 (Ú5, D13, revision U18) with OCCT in the browser: the cube and its
// buttons take the wheel and the right button, the rest of its 132 × 132 px square does not.
// There the wheel zooms and the right drag orbits the main view, like anywhere in the viewport.

/** Overlay of the cube: 132 px square, 8 px from the top and the right edge of the canvas. */
const BOX = 132;
const MARGIN = 8;

/** The main canvas (the view cube draws into it too). */
function canvas(page: Page): Locator {
  return page.locator('canvas').first();
}

/** Page points over the top-left corner of the overlay (off the cube) and the cube centre. */
async function cubePoints(
  page: Page,
): Promise<{ corner: { x: number; y: number }; centre: { x: number; y: number } }> {
  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  const left = box.x + box.width - MARGIN - BOX;
  const top = box.y + MARGIN;
  return {
    // Off the cube square (18 px gap) and off every arrow and the mode button.
    corner: { x: left + 6, y: top + 6 },
    centre: { x: left + BOX / 2, y: top + BOX / 2 },
  };
}

/** A screenshot of the canvas once two shots in a row are the same (fades and animations over). */
async function stableShot(page: Page): Promise<Buffer> {
  let previous = await canvas(page).screenshot();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await canvas(page).screenshot();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the canvas did not settle');
}

test.beforeEach(async ({ page }) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
});

test('the wheel zooms off the cube in its square, over the cube it does nothing', async ({
  page,
}) => {
  const { corner, centre } = await cubePoints(page);

  // Over the cube: the cube shows its hover and turns opaque, then the wheel changes nothing.
  await page.mouse.move(centre.x, centre.y);
  const beforeCube = await stableShot(page);
  await page.mouse.wheel(0, -400);
  expect((await stableShot(page)).equals(beforeCube)).toBe(true);

  // In the corner of the square: the wheel goes to the viewport and zooms.
  await page.mouse.move(corner.x, corner.y);
  const beforeCorner = await stableShot(page);
  await page.mouse.wheel(0, -400);
  expect((await stableShot(page)).equals(beforeCorner)).toBe(false);
});

test('the right drag in the corner of the square orbits the view', async ({ page }) => {
  const { corner } = await cubePoints(page);
  await page.mouse.move(corner.x, corner.y);
  const before = await stableShot(page);

  await page.mouse.down({ button: 'right' });
  await page.mouse.move(corner.x - 60, corner.y + 40, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  // Back at the start, so the cube is in the same hover state as in the first shot.
  await page.mouse.move(corner.x, corner.y);

  expect((await stableShot(page)).equals(before)).toBe(false);
  // No context menu of the page opened instead.
  await expect(page.getByRole('menu')).toBeHidden();
});
