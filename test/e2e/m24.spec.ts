import { expect, test } from './fixtures';
import type { Download, Locator, Page } from '@playwright/test';
import {
  confirmDialog,
  createDocument,
  expectNoErrors,
  fillParam,
  isoCanvasOffset,
  openTool,
  reloadWhenSaved,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The realistic display of M24 (spec 11, "Styl zobrazení" and "Materiál tělesa"; spec 09,
// "Realistic") with OCCT in the browser, in Czech: Realistický from the display style menu draws
// a different picture than Stínovaný, edges and transparency are greyed out in it and AO can be
// switched on; the material of a body chosen in the Browser changes the picture in Realistic only,
// survives a reload and an export with an import and can be undone; a picked face is highlighted
// in Realistic. Pictures are compared pixel for pixel (stable canvas shots, as in m23.spec.ts).

/** A 10 mm box at the origin and a smaller box on its top (as in m23.spec.ts). */
const BOUNDS_MIN = [0, 0, 0] as const;
const BOUNDS_MAX = [10, 10, 15] as const;
/** A point of the top face of the big box beside the small one, on the side seen from iso. */
const FREE_TOP_FACE = [9, 1, 10] as const;

/** The name of the first body in the Browser, in the labels of its material button and menu. */
const BODY_NAME = 'Těleso 1';

/** The main canvas. */
function canvas(page: Page): Locator {
  return page.locator('canvas').first();
}

/** The tree of the Browser, which lies over the canvas. */
function browserTree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Prohlížeč', exact: true });
}

/**
 * A screenshot of the canvas once two shots in a row are the same (fades and animations over).
 * Unlike m23.spec.ts the tree of the Browser is masked: it lies over the canvas and its rows show
 * their controls after a choice of the material (the focus goes back to the material button).
 */
async function stableShot(page: Page): Promise<Buffer> {
  // The pointer off the canvas, so no hover highlight gets into the shot, and no focus ring: the
  // shot is a clip of the page, the display style button and the panels lie over the canvas.
  await page.mouse.move(0, 0);
  const focused = page.locator(':focus');
  if ((await focused.count()) > 0) await focused.blur();
  const shoot = (): Promise<Buffer> => canvas(page).screenshot({ mask: [browserTree(page)] });
  let previous = await shoot();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await shoot();
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

async function openStyleMenu(page: Page): Promise<void> {
  await styleButton(page).click();
  await expect(styleMenu(page)).toBeVisible();
}

async function closeStyleMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(styleMenu(page)).toBeHidden();
}

async function chooseMode(page: Page, name: string): Promise<void> {
  await openStyleMenu(page);
  await mode(page, name).click();
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toHaveAccessibleName(`Styl zobrazení: ${name}`);
}

/** The material button of the first body; its name ends with the current material. */
function materialButton(page: Page): Locator {
  return browserTree(page).getByRole('button', { name: `Materiál ${BODY_NAME}: ` });
}

/** The material menu of the first body (teleported to <body>, so not in the tree). */
function materialMenu(page: Page): Locator {
  return page.getByRole('menu', { name: `Materiál ${BODY_NAME}`, exact: true });
}

/**
 * Hovers the row of the first body in the Browser: its material button is shown only on the
 * active row (hovered, focused or selected; spec 11).
 */
async function hoverBody(page: Page): Promise<void> {
  await browserTree(page)
    .getByRole('treeitem')
    .filter({ has: page.getByText(BODY_NAME, { exact: true }) })
    .hover();
}

/** The first body has the material of this Czech name (read from its button on the hovered row). */
async function expectMaterial(page: Page, label: string): Promise<void> {
  await hoverBody(page);
  await expect(materialButton(page)).toHaveAccessibleName(`Materiál ${BODY_NAME}: ${label}`);
}

async function openMaterialMenu(page: Page): Promise<void> {
  await hoverBody(page);
  await materialButton(page).click();
  await expect(materialMenu(page)).toBeVisible();
}

/** Chooses the material by its Czech text in the menu of the material button. */
async function chooseMaterial(page: Page, label: string): Promise<void> {
  await openMaterialMenu(page);
  await materialMenu(page).getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(materialMenu(page)).toBeHidden();
  await expect(materialButton(page)).toBeFocused();
  await expectMaterial(page, label);
}

/** File menu of the title bar → the item; resolves with the download it starts (m15.spec.ts). */
async function downloadFromFileMenu(page: Page, item: string): Promise<Download> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
  return downloading;
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

test('Realistický from the menu: another picture, edges and transparency greyed out, AO can be switched on', async ({
  page,
}) => {
  const shaded = await stableShot(page);
  await chooseMode(page, 'Realistický');
  const realistic = await stableShot(page);
  expect(realistic.equals(shaded)).toBe(false);

  await openStyleMenu(page);
  await expect(mode(page, 'Realistický')).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'Hrany')).toHaveAttribute('aria-disabled', 'true');
  await expect(toggle(page, 'Průhlednost')).toHaveAttribute('aria-disabled', 'true');
  await expect(toggle(page, 'Triangulace')).not.toHaveAttribute('aria-disabled', 'true');
  // AO is enabled in Realistic; switched on it changes the picture, off it gives it back.
  const ao = toggle(page, 'Ambientní okluze');
  await expect(ao).not.toHaveAttribute('aria-disabled', 'true');
  await expect(ao).toHaveAttribute('aria-checked', 'false');
  await ao.click();
  await expect(ao).toHaveAttribute('aria-checked', 'true');
  await expect(
    styleMenu(page).getByRole('menuitem', { name: 'Nastavení AO…', exact: true }),
  ).not.toHaveAttribute('aria-disabled', 'true');
  await closeStyleMenu(page);
  expect((await stableShot(page)).equals(realistic)).toBe(false);

  await openStyleMenu(page);
  await toggle(page, 'Ambientní okluze').click();
  await closeStyleMenu(page);
  expect((await stableShot(page)).equals(realistic)).toBe(true);

  // Back in Stínovaný (AO off again): the picture of Stínovaný.
  await chooseMode(page, 'Stínovaný');
  expect((await stableShot(page)).equals(shaded)).toBe(true);
});

test('the material from the Browser changes the picture in Realistický, not in Stínovaný', async ({
  page,
}) => {
  await expectMaterial(page, 'Plast');
  // Every material, in the order of BODY_MATERIALS, the current one checked and focused.
  await openMaterialMenu(page);
  const items = materialMenu(page).getByRole('menuitemradio');
  await expect(items).toHaveText(['Plast', 'Hliník', 'Ocel', 'Mosaz', 'Sklo', 'Guma']);
  await expect(items.first()).toHaveAttribute('aria-checked', 'true');
  await expect(items.first()).toBeFocused();
  for (const item of await items.filter({ hasNotText: 'Plast' }).all()) {
    await expect(item).toHaveAttribute('aria-checked', 'false');
  }
  // Esc closes it without a choice and gives the focus back to the button.
  await page.keyboard.press('Escape');
  await expect(materialMenu(page)).toBeHidden();
  await expect(materialButton(page)).toBeFocused();
  await expectMaterial(page, 'Plast');
  // The clicks on the button stayed there: the row of the body was not selected.
  await expect(
    browserTree(page)
      .getByRole('treeitem')
      .filter({ has: page.getByText(BODY_NAME, { exact: true }) }),
  ).not.toHaveAttribute('aria-selected', 'true');

  // Stínovaný: the material does not change the picture.
  const shadedPlastic = await stableShot(page);
  await chooseMaterial(page, 'Hliník');
  expect((await stableShot(page)).equals(shadedPlastic)).toBe(true);

  // Realistický: it does.
  await chooseMode(page, 'Realistický');
  const realisticAluminium = await stableShot(page);
  await chooseMaterial(page, 'Plast');
  const realisticPlastic = await stableShot(page);
  expect(realisticPlastic.equals(realisticAluminium)).toBe(false);
  // And back: the same picture of aluminium.
  await chooseMaterial(page, 'Hliník');
  expect((await stableShot(page)).equals(realisticAluminium)).toBe(true);
});

test('the material survives a reload and an export with an import, and can be undone', async ({
  page,
}) => {
  await chooseMaterial(page, 'Hliník');
  await reloadWhenSaved(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await expectMaterial(page, 'Hliník');

  // File → Export document → back to the documents → Import: the new document has the material,
  // and undo (the history came along) gives the plastic back.
  const exported = await downloadFromFileMenu(page, 'Exportovat dokument');
  const exportedPath = await exported.path();
  const sourceUrl = page.url();
  await page.getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importovat', exact: true }).click();
  await (await choosing).setFiles(exportedPath);

  await expect(page).toHaveURL(/#\/d\//);
  expect(page.url()).not.toBe(sourceUrl);
  await expect(timelineFeature(page, 'Kvádr 2')).toBeVisible();
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await expectMaterial(page, 'Hliník');

  await toolbarButton(page, 'Zpět').click();
  await expectMaterial(page, 'Plast');
  // The undo took the material only, the boxes stay.
  await expect(timelineFeature(page, 'Kvádr 2')).toBeVisible();
  await toolbarButton(page, 'Znovu').click();
  await expectMaterial(page, 'Hliník');
});

test('in Realistický a face can be picked and its highlight is seen', async ({ page }) => {
  const { dx, dy } = await isoCanvasOffset(page, BOUNDS_MIN, BOUNDS_MAX, FREE_TOP_FACE);
  await chooseMode(page, 'Realistický');
  const nothingPicked = await stableShot(page);

  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  const picked = await stableShot(page);
  expect(picked.equals(nothingPicked)).toBe(false);

  // Esc on the canvas clears the selection: the picture without the highlight again.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  expect((await stableShot(page)).equals(nothingPicked)).toBe(true);
  // The console stays clean (fixtures).
});
