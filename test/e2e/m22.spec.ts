import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  isoCanvasOffset,
  openTool,
  refField,
  reloadWhenSaved,
} from './helpers';

// The display style menu of M22 (spec 11, "Styl zobrazení") with OCCT in the browser, in Czech:
// every mode and toggle from the menu, the keyboard of the menu, the choice surviving a reload,
// and in the wireframe a click on a back edge of the box picking it (spec 09, "Styl zobrazení").

/** The default box of the box feature (box schema defaults): 10 × 10 × 10 mm at the origin. */
const BOX_MIN = [0, 0, 0] as const;
const BOX_MAX = [10, 10, 10] as const;
/**
 * The middle of the top face. The iso view looks along (−1, 1, −1), so the hidden back edge
 * (0, 10, 0)–(0, 10, 10) lies right behind it: its middle (0, 10, 5) is (5, 5, 10) − 5 · (1, −1, 1).
 */
const TOP_FACE_MIDDLE = [5, 5, 10] as const;

const MODES = ['Stínovaný', 'Bez skrytých hran', 'Se skrytými hranami', 'Drátový model'];

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
  await expect(styleButton(page)).toHaveAttribute('aria-expanded', 'true');
}

/** From the menu: the mode is chosen, the menu closes and the button names the mode. */
async function chooseMode(page: Page, name: string): Promise<void> {
  await openStyleMenu(page);
  await mode(page, name).click();
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toHaveAccessibleName(`Styl zobrazení: ${name}`);
  await expect(styleButton(page)).toHaveAttribute('aria-expanded', 'false');
}

async function addFittedBox(page: Page): Promise<void> {
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  // The camera of a new document stays put (M19.2 D7): fit it on the box for isoCanvasOffset.
  await page.keyboard.press('f');
}

test.beforeEach(async ({ page }) => {
  await createDocument(page);
  await addFittedBox(page);
});

test('the menu lists the modes and the toggles, every one of them works', async ({ page }) => {
  await expect(styleButton(page)).toHaveAccessibleName('Styl zobrazení: Stínovaný');
  await expect(styleButton(page)).toHaveAttribute('aria-haspopup', 'menu');
  await openStyleMenu(page);
  await expect(styleMenu(page).getByRole('menuitemradio')).toHaveText(MODES);
  // The toggles of M22; Ambientní okluze and Nastavení AO… of M23 are tested in m23.spec.ts.
  await expect(styleMenu(page).getByRole('menuitemcheckbox')).toHaveText([
    'Hrany',
    'Průhlednost',
    'Ambientní okluze',
    'Triangulace',
  ]);
  await expect(mode(page, 'Stínovaný')).toHaveAttribute('aria-checked', 'true');

  // In shaded every toggle works; a toggle keeps the menu open.
  await expect(toggle(page, 'Hrany')).toHaveAttribute('aria-checked', 'true');
  for (const name of ['Hrany', 'Průhlednost', 'Triangulace']) {
    const item = toggle(page, name);
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    const before = await item.getAttribute('aria-checked');
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await expect(styleMenu(page)).toBeVisible();
    // And back.
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', before ?? 'false');
  }
  // Transparency and the mesh on for the modes below.
  await toggle(page, 'Průhlednost').click();
  await toggle(page, 'Triangulace').click();
  await page.keyboard.press('Escape');
  await expect(styleMenu(page)).toBeHidden();

  // Every mode; outside shaded edges and transparency are greyed out and keep their value.
  for (const name of [...MODES.slice(1), MODES[0] ?? '']) {
    await chooseMode(page, name);
    await openStyleMenu(page);
    await expect(mode(page, name)).toHaveAttribute('aria-checked', 'true');
    const greyed = name === 'Stínovaný' ? 0 : 2;
    // Plus Ambientní okluze and Nastavení AO… of M23: greyed out in every pass, as transparency
    // is on (m23.spec.ts).
    await expect(styleMenu(page).locator('[aria-disabled="true"]')).toHaveCount(greyed + 2);
    if (greyed > 0) {
      await expect(toggle(page, 'Hrany')).toHaveAttribute('aria-disabled', 'true');
      await expect(toggle(page, 'Průhlednost')).toHaveAttribute('aria-disabled', 'true');
      // A greyed-out toggle cannot be switched (force: Playwright itself refuses aria-disabled).
      await toggle(page, 'Průhlednost').click({ force: true });
      await expect(toggle(page, 'Průhlednost')).toHaveAttribute('aria-checked', 'true');
    }
    await expect(toggle(page, 'Triangulace')).not.toHaveAttribute('aria-disabled', 'true');
    // The mesh in every mode, on and off.
    await toggle(page, 'Triangulace').click();
    await expect(toggle(page, 'Triangulace')).toHaveAttribute('aria-checked', 'false');
    await toggle(page, 'Triangulace').click();
    await expect(toggle(page, 'Triangulace')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(styleMenu(page)).toBeHidden();
  }
  // The console stays clean (fixtures).
});

test('the menu works from the keyboard; Esc and a click outside close it', async ({ page }) => {
  await chooseMode(page, 'Drátový model');
  await openStyleMenu(page);
  // The first item has the focus; the arrows skip the greyed-out toggles.
  await expect(mode(page, 'Stínovaný')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(mode(page, 'Bez skrytých hran')).toBeFocused();
  await page.keyboard.press('End');
  await expect(toggle(page, 'Triangulace')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(mode(page, 'Drátový model')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(mode(page, 'Stínovaný')).toBeFocused();

  // Space switches a toggle and keeps the menu open.
  await page.keyboard.press('End');
  await page.keyboard.press(' ');
  await expect(toggle(page, 'Triangulace')).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'Triangulace')).toBeFocused();

  // Enter chooses a mode, closes the menu and gives the focus back to the button.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toHaveAccessibleName('Styl zobrazení: Bez skrytých hran');
  await expect(styleButton(page)).toBeFocused();

  // Esc closes it, the focus goes back to the button.
  await openStyleMenu(page);
  await page.keyboard.press('Escape');
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toBeFocused();

  // A click outside closes it; the mode stays.
  await openStyleMenu(page);
  await clickCanvas(page, 0, 200);
  await expect(styleMenu(page)).toBeHidden();
  await expect(styleButton(page)).toHaveAccessibleName('Styl zobrazení: Bez skrytých hran');
  // A second click on the button closes the menu it opened.
  await openStyleMenu(page);
  await styleButton(page).click();
  await expect(styleMenu(page)).toBeHidden();
});

test('the chosen style survives a reload', async ({ page }) => {
  await chooseMode(page, 'Se skrytými hranami');
  await openStyleMenu(page);
  await toggle(page, 'Triangulace').click();
  await page.keyboard.press('Escape');

  await reloadWhenSaved(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expect(styleButton(page)).toHaveAccessibleName('Styl zobrazení: Se skrytými hranami');
  await openStyleMenu(page);
  await expect(mode(page, 'Se skrytými hranami')).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'Triangulace')).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'Hrany')).toHaveAttribute('aria-checked', 'true');
});

test('in the wireframe a click on a back edge of the box picks it', async ({ page }) => {
  const { dx, dy } = await isoCanvasOffset(page, BOX_MIN, BOX_MAX, TOP_FACE_MIDDLE);
  const fillet = await openTool(page, 'Zaoblení', 'Zaoblení 1');
  const edges = refField(fillet, 'Hrany');
  await expect(edges).toHaveAttribute('aria-pressed', 'true');

  // Shaded: the top face covers the back edge, the edge field takes nothing.
  await clickCanvas(page, dx, dy);
  await expect(edges).toHaveText('Vybráno: 0 · vyberte v pohledu');

  // Wireframe: no faces to cover it, the same click picks the back edge.
  await chooseMode(page, 'Drátový model');
  await expect(edges).toHaveAttribute('aria-pressed', 'true');
  await clickCanvas(page, dx, dy);
  await expect(edges).toHaveText('Vybráno: 1 · vyberte v pohledu');
});
