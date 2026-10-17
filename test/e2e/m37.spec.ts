import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  confirmDialog,
  createDocument,
  expectNoErrors,
  fillParam,
  isoCanvasOffset,
  openConstraintSection,
  openTool,
  pickVariant,
  refField,
  sketchPanel,
  timelineFeature,
  toolbarButton,
} from './helpers';

// The scenarios of M37 (Ú4; spec 12, "Text ve skice (M37)") with OCCT, planegcs and the bundled
// fonts in the browser, in Czech: the Text tool writes "Text" on a construction baseline and gives
// the string field of the panel the focus; the string, the font and the height changed in the
// panel are in the exported document with matching outlines. "tinycad" engraved into the top face
// of a box by an extrude that removes the letters. The hint HUD tells what the Text, the Line and
// the Mirror tool wait for.

/** The parts of an exported document the tests read (persistence TinycadFile, spec 05). */
interface ExportedDocument {
  readonly snapshot: {
    readonly document: {
      readonly studio: { readonly features: readonly ExportedFeature[] };
    };
  };
}

interface ExportedFeature {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The sketch entities the tests read (sketch model). */
type ExportedEntity =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly text: string;
      readonly font: string;
      readonly height: number;
      readonly baseline: string;
      readonly contours: readonly {
        readonly char: number;
        readonly code: number;
        readonly segments: readonly unknown[];
      }[];
    }
  | { readonly kind: 'line'; readonly id: string; readonly construction?: true }
  | { readonly kind: 'point'; readonly id: string };

/** The default box of these scenarios: 100 × 100 × 10 mm centred on the origin in x and y. */
const BOX_MIN = [-50, -50, 0] as const;
const BOX_MAX = [50, 50, 10] as const;

/** Into a new sketch on the XY plane with the grid snap off and the constraint list open. */
async function openSketchWithoutGrid(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  // Opened before drawing: a click into the panel takes the focus from the view, whose keys
  // (Enter and Escape of the tools) need it until the next click on the canvas (as in m36).
  await openConstraintSection(panel);
  return panel;
}

/** The Text tool, a variant of the line family (the toolbar may not grow, spec 12). */
async function pickTextTool(page: Page): Promise<void> {
  await pickVariant(page, 'Úsečka', 'Text');
  await expect(toolbarButton(page, 'Text')).toHaveClass(/active/);
}

/** A click of the Text tool writes "Text"; its string field gets the focus, the text selected. */
async function placeText(page: Page, panel: Locator, dx: number, dy: number): Promise<Locator> {
  await clickCanvas(page, dx, dy);
  const field = panel.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toHaveValue('Text');
  await expect(field).toBeFocused();
  return field;
}

/** Types into the focused string field of the text (replacing the selection) and Enter. */
async function typeText(field: Locator, text: string): Promise<void> {
  await field.pressSequentially(text);
  await field.press('Enter');
  await expect(field).toHaveValue(text);
}

/** The height field of the text section: the value typed, Enter. */
async function setTextHeight(panel: Locator, value: string): Promise<void> {
  const height = panel.getByRole('textbox', { name: 'Výška', exact: true });
  await height.fill(value);
  await height.press('Enter');
  await expect(height).toHaveValue(value);
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** File → Export document; the parsed file. */
async function exportDocument(page: Page): Promise<ExportedDocument> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Exportovat dokument', exact: true })
    .click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  // The file is the export of the app under test (TinycadFile); the test reads only the parts
  // described by ExportedDocument.
  return JSON.parse(text) as ExportedDocument;
}

/** The entities of the sketch feature. */
function entitiesOf(doc: ExportedDocument, sketch: string): readonly ExportedEntity[] {
  const found = doc.snapshot.document.studio.features.find((f) => f.name === sketch);
  if (found === undefined) throw new Error(`no feature ${sketch}`);
  // A sketch keeps its entities in the data param 'entities' (sketch model, SKETCH_PARAM).
  const entities = found.params['entities'];
  if (!Array.isArray(entities)) throw new Error(`no entities in ${sketch}`);
  // The export is the document as stored; parseSketchData checked it when it was written.
  return entities as readonly ExportedEntity[];
}

/** The only text of the sketch. */
function onlyText(entities: readonly ExportedEntity[]): Extract<ExportedEntity, { kind: 'text' }> {
  const texts = entities.filter(
    (e): e is Extract<ExportedEntity, { kind: 'text' }> => e.kind === 'text',
  );
  expect(texts).toHaveLength(1);
  const [text] = texts;
  if (text === undefined) throw new Error('no text');
  return text;
}

/** Every contour belongs to a letter of the string, and every non-space letter has one. */
function expectMatchingContours(text: Extract<ExportedEntity, { kind: 'text' }>): void {
  const chars = Array.from(text.text);
  for (const contour of text.contours) {
    expect(contour.code).toBe(chars[contour.char]?.codePointAt(0));
    expect(contour.segments.length).toBeGreaterThan(0);
  }
  const outlined = new Set(text.contours.map((c) => c.char));
  chars.forEach((c, i) => {
    if (c !== ' ') expect(outlined.has(i)).toBe(true);
  });
}

/**
 * A row of the Browser, named by its displayed text ("Těleso 1", "Oblast 1"). A body row is
 * clicked on its name (as in m13).
 */
function browserRow(page: Page, name: string): Locator {
  return page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) });
}

/** The tool hint HUD at the top of the view, by its text. */
function hint(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text });
}

test('the Text tool writes Text, the panel changes it to tinycad in serif 5 mm', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // 1. A click writes the construction baseline (two free points: 4 degrees of freedom) and the
  // text "Text" on it; the string field has the focus with the whole text selected.
  await pickTextTool(page);
  const field = await placeText(page, panel, -150, 40);
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(field).toHaveJSProperty('selectionStart', 0);
  await expect(field).toHaveJSProperty('selectionEnd', 4);

  // 2. Typing replaces it; Enter commits. Then the font and the height.
  await typeText(field, 'tinycad');
  await panel.getByRole('combobox', { name: 'Písmo', exact: true }).selectOption({
    label: 'Patkové',
  });
  await setTextHeight(panel, '5');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. The document has the text with its outlines and the construction baseline it hangs on.
  const entities = entitiesOf(await exportDocument(page), 'Skica 1');
  const text = onlyText(entities);
  expect(text.text).toBe('tinycad');
  expect(text.font).toBe('serif');
  expect(text.height).toBe(5);
  expectMatchingContours(text);
  const baseline = entities.find((e) => e.kind === 'line' && e.id === text.baseline);
  expect(baseline).toMatchObject({ kind: 'line', construction: true });
});

test('tinycad engraved into the top face of a box by an extrude that removes it', async ({
  page,
}) => {
  await createDocument(page);

  // 1. A box 100 × 100 × 10 mm around the origin; "Zobrazit vše" (F) fits the view on it.
  const box = await openTool(page, 'Kvádr', 'Kvádr 1');
  await fillParam(page, 'Počátek X', String(BOX_MIN[0]));
  await fillParam(page, 'Počátek Y', String(BOX_MIN[1]));
  await fillParam(page, 'Šířka', '100');
  await fillParam(page, 'Hloubka', '100');
  await confirmDialog(box);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await page.keyboard.press('f');

  // 2. A sketch on the top face: the camera looks at the face, fitted on the box, so a text
  // starting a little left of the middle of the canvas lies on the face.
  const { dx, dy } = await isoCanvasOffset(page, BOX_MIN, BOX_MAX, [0, 0, 10]);
  await clickCanvas(page, dx, dy);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  await pickTextTool(page);
  const field = await placeText(page, panel, -60, 20);
  await typeText(field, 'tinycad');
  await setTextHeight(panel, '8');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await finishSketch(panel);
  await expectNoErrors(page);

  // 3. Extrude the letters, removing 1 mm from the box (against the normal of the face). The
  // regions are sorted by name, i.e. by the index of the letter and the loop (spec 12): t, the
  // two parts of i, n, y, c, the body of a, its counter, the body of d, its counter. The
  // counters stay, so the a and the d keep their holes.
  const cut = await openTool(page, 'Vysunutí', 'Vysunutí 1');
  const regions = refField(cut, 'Oblasti');
  await expect(regions).toHaveAttribute('aria-pressed', 'true');
  await expect(browserRow(page, 'Oblast 10')).toHaveCount(1);
  await expect(browserRow(page, 'Oblast 11')).toHaveCount(0);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 9]) await browserRow(page, `Oblast ${String(n)}`).click();
  await expect(regions).toHaveText('Vybráno: 8 · vyberte v pohledu');
  await cut.getByRole('combobox', { name: 'Operace', exact: true }).selectOption({
    label: 'Odebrat',
  });
  const targets = refField(cut, 'Sloučit s');
  await targets.click();
  await expect(targets).toHaveAttribute('aria-pressed', 'true');
  await browserRow(page, 'Těleso 1').getByText('Těleso 1', { exact: true }).click();
  await expect(cut.getByRole('button', { name: 'Odebrat Kvádr 1', exact: true })).toBeVisible();
  await fillParam(page, 'Vzdálenost', '1');
  await cut.getByRole('checkbox', { name: 'Opačný směr', exact: true }).check();
  await confirmDialog(cut);

  // 4. The engraved box regenerates without an error; still one body.
  const extrude = timelineFeature(page, 'Vysunutí 1');
  await expect(extrude).toBeVisible();
  await expect(extrude).not.toHaveAccessibleDescription(/Chyba|Varování/);
  await expectNoErrors(page);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
});

test('the hint HUD tells what the Text and the Mirror tool wait for', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);

  // The Text tool waits for the start of the baseline; the line tool shows its own hint per step.
  // (The view does not have the focus after the menu of the family, so no Escape here.)
  await pickTextTool(page);
  const place = hint(page, 'Klikni na počátek účaří textu');
  await expect(place).toBeVisible();
  await pickVariant(page, 'Text', 'Úsečka');
  await expect(place).toHaveCount(0);
  await expect(hint(page, 'Klikni na první bod úsečky')).toBeVisible();

  // A line, then the Mirror tool: first the sources, after Enter the axis.
  await clickCanvas(page, -160, -60);
  await expect(hint(page, 'Klikni na další bod nebo napiš délku a úhel')).toBeVisible();
  await clickCanvas(page, -60, 50);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('status')).toHaveText('Stupně volnosti: 4');
  await pickVariant(page, 'Ořezat', 'Zrcadlit');
  await expect(hint(page, 'Vyber body a křivky ke zrcadlení, Enter pokračuje')).toBeVisible();
  await clickCanvas(page, -110, -5);
  await page.keyboard.press('Enter');
  await expect(hint(page, 'Klikni na osu zrcadlení (úsečka nebo přímka), Esc zpět')).toBeVisible();
  await expect(hint(page, 'Vyber body a křivky ke zrcadlení, Enter pokračuje')).toHaveCount(0);
});
