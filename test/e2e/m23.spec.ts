import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  fillParam,
  isoCanvasOffset,
  openTool,
  reloadWhenSaved,
} from './helpers';

// The ambient occlusion of M23 (spec 11, "Styl zobrazení" and "Nastavení AO"; spec 09,
// "Víceprůchodové vykreslování (AO)") with OCCT in the browser, in Czech: the AO toggle of the
// display style menu changes the picture and switching it off gives the same picture back, it is
// greyed out where AO does not draw, it survives a reload, a picked face is highlighted with AO,
// and the panel of the AO settings changes the picture, keeps its value over a reload and gives
// the default picture back. Pictures are compared pixel for pixel (stable canvas shots).

/** A 10 mm box at the origin and a smaller box on its top: inner corners where they meet. */
const BOUNDS_MIN = [0, 0, 0] as const;
const BOUNDS_MAX = [10, 10, 15] as const;
/** A point of the top face of the big box beside the small one, on the side seen from iso. */
const FREE_TOP_FACE = [9, 1, 10] as const;

const MODES = ['Bez skrytých hran', 'Se skrytými hranami', 'Drátový model'];

/** The main canvas. */
function canvas(page: Page): Locator {
  return page.locator('canvas').first();
}

/** A screenshot of the canvas once two shots in a row are the same (fades and animations over). */
async function stableShot(page: Page): Promise<Buffer> {
  // The pointer off the canvas, so no hover highlight gets into the shot, and no focus ring: the
  // shot is a clip of the page, the display style button and the panels lie over the canvas.
  await page.mouse.move(0, 0);
  const focused = page.locator(':focus');
  if ((await focused.count()) > 0) await focused.blur();
  let previous = await canvas(page).screenshot();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await canvas(page).screenshot();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the canvas did not settle');
}

function styleButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Styl zobrazení: / });
}

function styleMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Styl zobrazení', exact: true });
}

function mode(page: Page, name: string): Locator {
  return styleMenu(page).getByRole('menuitemradio', { name, exact: true });
}

function toggle(page: Page, name: string): Locator {
  return styleMenu(page).getByRole('menuitemcheckbox', { name, exact: true });
}

function aoToggle(page: Page): Locator {
  return toggle(page, 'Ambientní okluze');
}

function aoSettingsItem(page: Page): Locator {
  return styleMenu(page).getByRole('menuitem', { name: 'Nastavení AO…', exact: true });
}

function aoPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Ambientní okluze', exact: true });
}

function radiusSlider(page: Page): Locator {
  return aoPanel(page).getByRole('slider', { name: 'Poloměr (px)', exact: true });
}

async function openStyleMenu(page: Page): Promise<void> {
  await styleButton(page).click();
  await expect(styleMenu(page)).toBeVisible();
}

async function closeStyleMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(styleMenu(page)).toBeHidden();
}

/** From the menu: AO switched to `on`; the menu closes again. */
async function setAo(page: Page, on: boolean): Promise<void> {
  await openStyleMenu(page);
  if ((await aoToggle(page).getAttribute('aria-checked')) !== String(on)) {
    await aoToggle(page).click();
  }
  await expect(aoToggle(page)).toHaveAttribute('aria-checked', String(on));
  await closeStyleMenu(page);
}

async function chooseMode(page: Page, name: string): Promise<void> {
  await openStyleMenu(page);
  await mode(page, name).click();
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toHaveAccessibleName(`Styl zobrazení: ${name}`);
}

/** From the menu (AO on): the panel of the AO settings opens, the radius slider has the focus. */
async function openAoPanel(page: Page): Promise<void> {
  await openStyleMenu(page);
  await aoSettingsItem(page).click();
  await expect(styleMenu(page)).toBeHidden();
  await expect(aoPanel(page)).toBeVisible();
  await expect(radiusSlider(page)).toBeFocused();
}

/** The big box, the small box on its top, and the view fitted on both (for isoCanvasOffset). */
async function addBoxes(page: Page): Promise<void> {
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  const dialog = await openTool(page, 'Kvádr', 'Kvádr 2');
  await fillParam(page, 'Počátek X', '2');
  await fillParam(page, 'Počátek Y', '2');
  await fillParam(page, 'Počátek Z', '10');
  await fillParam(page, 'Šířka', '5');
  await fillParam(page, 'Hloubka', '5');
  await fillParam(page, 'Výška', '5');
  await confirmDialog(dialog);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  // The camera of a new document stays put (M19.2 D7): fit it on the boxes.
  await page.keyboard.press('f');
}

test.beforeEach(async ({ page }) => {
  await createDocument(page);
  await addBoxes(page);
});

test('AO changes the picture; switched off, the picture is the same as before', async ({
  page,
}) => {
  const withoutAo = await stableShot(page);
  await setAo(page, true);
  const withAo = await stableShot(page);
  expect(withAo.equals(withoutAo)).toBe(false);

  await setAo(page, false);
  expect((await stableShot(page)).equals(withoutAo)).toBe(true);
});

test('AO is greyed out in transparent shaded and in the other modes, its value stays', async ({
  page,
}) => {
  await setAo(page, true);
  await openStyleMenu(page);
  await expect(aoToggle(page)).not.toHaveAttribute('aria-disabled', 'true');

  // Transparent shaded: greyed out, still checked, cannot be switched.
  await toggle(page, 'Průhlednost').click();
  await expect(aoToggle(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(aoToggle(page)).toHaveAttribute('aria-checked', 'true');
  await aoToggle(page).click({ force: true });
  await expect(aoToggle(page)).toHaveAttribute('aria-checked', 'true');
  await toggle(page, 'Průhlednost').click();
  await expect(aoToggle(page)).not.toHaveAttribute('aria-disabled', 'true');
  await closeStyleMenu(page);

  // The other modes: greyed out, the value kept.
  for (const name of MODES) {
    await chooseMode(page, name);
    await openStyleMenu(page);
    await expect(aoToggle(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(aoToggle(page)).toHaveAttribute('aria-checked', 'true');
    await closeStyleMenu(page);
  }
  await chooseMode(page, 'Stínovaný');
  await openStyleMenu(page);
  await expect(aoToggle(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(aoToggle(page)).toHaveAttribute('aria-checked', 'true');
});

test('the AO choice survives a reload', async ({ page }) => {
  await setAo(page, true);
  await reloadWhenSaved(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await openStyleMenu(page);
  await expect(aoToggle(page)).toHaveAttribute('aria-checked', 'true');
});

test('with AO a face can be picked and its highlight is seen', async ({ page }) => {
  const { dx, dy } = await isoCanvasOffset(page, BOUNDS_MIN, BOUNDS_MAX, FREE_TOP_FACE);
  await setAo(page, true);
  const nothingPicked = await stableShot(page);

  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  const picked = await stableShot(page);
  expect(picked.equals(nothingPicked)).toBe(false);

  // Esc on the canvas clears the selection (the select tool gets the keys of the focused
  // canvas): the picture without the highlight again.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  expect((await stableShot(page)).equals(nothingPicked)).toBe(true);
});

test('the AO settings: enabled only with AO, the radius changes the picture, survives a reload, Výchozí gives the defaults back', async ({
  page,
}) => {
  await openStyleMenu(page);
  await expect(aoSettingsItem(page)).toHaveAttribute('aria-disabled', 'true');
  await aoToggle(page).click();
  await expect(aoSettingsItem(page)).not.toHaveAttribute('aria-disabled', 'true');
  await closeStyleMenu(page);

  // The panel lies over the canvas: every shot below is taken with it open.
  await openAoPanel(page);
  await expect(radiusSlider(page)).toHaveValue('32');
  const defaults = await stableShot(page);

  // The radius to its maximum from the keyboard (input and change, like a released slider).
  await radiusSlider(page).focus();
  await page.keyboard.press('End');
  await expect(radiusSlider(page)).toHaveValue('128');
  const largeRadius = await stableShot(page);
  expect(largeRadius.equals(defaults)).toBe(false);

  // Výchozí: the default value and the default picture.
  // From the keyboard: a click would leave the button in a slightly different paint state
  // (hover) than in the first shot.
  await aoPanel(page).getByRole('button', { name: 'Výchozí', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(radiusSlider(page)).toHaveValue('32');
  expect((await stableShot(page)).equals(defaults)).toBe(true);

  // A changed value survives a reload (the panel itself does not stay open). Compared by the
  // value, not by a shot: the camera after a reload need not be the fitted one.
  await radiusSlider(page).focus();
  await page.keyboard.press('End');
  await expect(radiusSlider(page)).toHaveValue('128');
  await reloadWhenSaved(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await expect(aoPanel(page)).toBeHidden();
  await openAoPanel(page);
  await expect(radiusSlider(page)).toHaveValue('128');

  // Esc closes the panel, the focus goes back to the display style button.
  await expect(radiusSlider(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(aoPanel(page)).toBeHidden();
  await expect(styleButton(page)).toBeFocused();
});
