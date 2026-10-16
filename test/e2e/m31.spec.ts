import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  constraintSection,
  createDocument,
  openConstraintSection,
  pickVariant,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The new drawing tools of M31 (spec 12, "Nové kreslicí nástroje (M31)", "Nekonečná přímka (M31,
// stopa B)") with planegcs in the browser, in Czech: a centre rectangle (four lines held by
// Vodorovná, Svislá and Střed of a construction diagonal), a 3-point rectangle (Kolmost and two
// Rovnoběžnost), a centre slot (four Tečnost and Shodná velikost), points (free and on a line), a
// construction line made parallel to a line, and the construction mode (Q without a selection):
// a drawn line is a construction one. The grid snap is switched off, so the clicks land where
// they are; the data are read from the exported document (File → Export document).

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

/** The sketch entities the tests read (sketch model): the kind and the construction flag. */
interface ExportedEntity {
  readonly kind: string;
  readonly id: string;
  readonly construction?: true;
}

/** Into a new sketch with the grid snap off and the constraint list open; returns the panel. */
async function openSketchWithoutGrid(page: Page): Promise<Locator> {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const grid = panel.getByRole('button', { name: 'Přichytit k mřížce', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  // Opened before drawing: a click into the panel takes the focus from the view, whose keys
  // (Escape of the tools, Q) need it until the next click on the canvas (as in m26).
  await openConstraintSection(panel);
  return panel;
}

/** The name buttons of the constraint rows of a kind ("Tečnost 1", "Tečnost 2" …). */
function constraintRowsOf(panel: Locator, kind: string): Locator {
  return constraintSection(panel).getByRole('button', { name: new RegExp(`^${kind} \\d+$`) });
}

/** Finish of the sketch panel; the panel closes. */
async function finishSketch(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Hotovo', exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** File → Export document; the entities of the sketch 'Skica 1'. */
async function exportedEntities(page: Page): Promise<readonly ExportedEntity[]> {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Exportovat dokument', exact: true })
    .click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  // The file is the export of the app under test (TinycadFile); the test reads only the parts
  // described by ExportedDocument.
  const doc = JSON.parse(text) as ExportedDocument;
  const sketch = doc.snapshot.document.studio.features.find((f) => f.name === 'Skica 1');
  // A sketch keeps its entities in the data param 'entities' (sketch model, SKETCH_PARAM).
  const entities = sketch?.params['entities'];
  if (!Array.isArray(entities)) throw new Error('no entities in Skica 1');
  // The export is the document as stored; parseSketchData checked it when it was written.
  return entities as readonly ExportedEntity[];
}

const linesOf = (entities: readonly ExportedEntity[]) => entities.filter((e) => e.kind === 'line');

test('a centre rectangle: four lines and a construction diagonal held by its constraints', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // The centre and a corner, aligned with nothing (no inference).
  await pickVariant(page, 'Obdélník rohy', 'Obdélník středem');
  await expect(toolbarButton(page, 'Obdélník středem')).toHaveClass(/active/);
  await clickCanvas(page, 40, -30);
  await clickCanvas(page, 140, -90);

  // Four corners and the centre (10) minus 2× Vodorovná, 2× Svislá and Střed (2): the centre,
  // the width and the height.
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(constraintRowsOf(panel, 'Vodorovná')).toHaveCount(2);
  await expect(constraintRowsOf(panel, 'Svislá')).toHaveCount(2);
  await expect(constraintRowsOf(panel, 'Střed')).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await finishSketch(panel);
  const lines = linesOf(await exportedEntities(page));
  expect(lines).toHaveLength(5);
  expect(lines.filter((l) => l.construction === true)).toHaveLength(1);
});

test('a 3-point rectangle: Kolmost and two Rovnoběžnost', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // A slanted first side (about 11°, no Vodorovná), then the height.
  await pickVariant(page, 'Obdélník rohy', 'Obdélník 3 body');
  await clickCanvas(page, -100, 50);
  await clickCanvas(page, 60, 20);
  await clickCanvas(page, 80, -60);

  // Four corners (8) minus Kolmost and 2× Rovnoběžnost: the position, the turn, the sides.
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(constraintRowsOf(panel, 'Kolmost')).toHaveCount(1);
  await expect(constraintRowsOf(panel, 'Rovnoběžnost')).toHaveCount(2);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a centre slot: two lines and two arcs, four Tečnost and Shodná velikost', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // A slanted axis (no Vodorovná), then the width beside it.
  await toolbarButton(page, 'Drážka středy').click();
  await clickCanvas(page, -80, 40);
  await clickCanvas(page, 80, 10);
  await clickCanvas(page, 0, -30);

  // Two centres and the radius, as in the table of spec 12.
  await expect(status).toHaveText('Stupně volnosti: 5');
  await expect(constraintRowsOf(panel, 'Tečnost')).toHaveCount(4);
  await expect(constraintRowsOf(panel, 'Shodná velikost')).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await finishSketch(panel);
  const entities = await exportedEntities(page);
  expect(entities.filter((e) => e.kind === 'arc')).toHaveLength(2);
  const lines = linesOf(entities);
  expect(lines).toHaveLength(3);
  // The axis c1c2 is a construction line.
  expect(lines.filter((l) => l.construction === true)).toHaveLength(1);
});

test('points: one on a line gets Bod na křivce, a free one; Escape ends the tool', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // A horizontal line (Vodorovná): 3 degrees of freedom.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, 100, 60);
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 3');

  // A point on the line off its middle (+1), a free point (+2).
  // The point is a variant of the line family (the sketcher toolbar fits 1280 px).
  await pickVariant(page, 'Úsečka', 'Bod');
  await clickCanvas(page, 50, 60);
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(constraintRowsOf(panel, 'Bod na křivce')).toHaveCount(1);
  await clickCanvas(page, -50, -50);
  await expect(status).toHaveText('Stupně volnosti: 6');

  // The point tool has no work in progress: Escape ends it.
  await expect(toolbarButton(page, 'Bod')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(toolbarButton(page, 'Bod')).not.toHaveClass(/active/);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('a construction line and a line made parallel to it get Rovnoběžnost', async ({ page }) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');

  // A slanted construction line through two points (about 17°, no Vodorovná): 4.
  await pickVariant(page, 'Úsečka', 'Konstrukční přímka');
  await clickCanvas(page, -100, 50);
  await clickCanvas(page, 100, -10);
  await expect(status).toHaveText('Stupně volnosti: 4');

  // A line below it, aligned with none of its points: 4 more.
  await pickVariant(page, 'Konstrukční přímka', 'Úsečka');
  await clickCanvas(page, -60, 120);
  await clickCanvas(page, 140, 60);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 8');

  // The construction line far beyond its two points, then with Shift the line; Rovnoběžnost.
  await clickCanvas(page, 200, -40);
  await page.keyboard.down('Shift');
  await clickCanvas(page, 40, 90);
  await page.keyboard.up('Shift');
  await toolbarButton(page, 'Rovnoběžnost').click();
  await expect(constraintRowsOf(panel, 'Rovnoběžnost')).toHaveCount(1);
  await expect(status).toHaveText('Stupně volnosti: 7');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await finishSketch(panel);
  const xlines = (await exportedEntities(page)).filter((e) => e.kind === 'xline');
  expect(xlines).toHaveLength(1);
  expect(xlines[0]?.construction).toBe(true);
});

test('the construction mode: Q without a selection, then a drawn line is a construction one', async ({
  page,
}) => {
  const panel = await openSketchWithoutGrid(page);
  const status = panel.getByRole('status');
  const mode = toolbarButton(page, 'Konstrukční');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');

  // A click into empty space gives the view the focus with nothing selected; Q switches the mode.
  await clickCanvas(page, 150, 150);
  await page.keyboard.press('q');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');

  // A slanted line, Escape ends the chain; the mode stays on.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 40);
  await clickCanvas(page, 60, -30);
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');

  await finishSketch(panel);
  const lines = linesOf(await exportedEntities(page));
  expect(lines).toHaveLength(1);
  expect(lines[0]?.construction).toBe(true);
});
