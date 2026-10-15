import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  clickCanvas,
  constraintSection,
  createDocument,
  sketchPanel,
  toolbarButton,
} from './helpers';

// The glyphs of the constraints of M25 (spec 12, "Glyfy vazeb (M25)") in the browser, in Czech: a
// horizontal line gets its constraint from the line tool; without a selection no glyph is shown,
// selecting the line shows the glyph "Vodorovná", hovering it highlights it, a click selects it
// and Delete removes the constraint, so the degrees of freedom go up. The switch "Zobrazit vazby"
// shows the glyphs of all constraints without a selection; the list of the constraints in the
// panel is collapsed by default.

/**
 * A glyph over the view, named by its constraint ("Vodorovná"). The toolbar has a tool of the
 * same name, so the glyph is looked for in the layer of the glyphs (it has no role of its own).
 */
function glyph(page: Page, name: string): Locator {
  return page.locator('.sketch-glyphs').getByRole('button', { name, exact: true });
}

/** Moves the pointer onto the canvas at (dx, dy) px from its centre, without a click. */
async function moveOverCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) throw new Error('the canvas is not visible');
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test('constraint glyphs: shown for the selection or all, hover, click and Delete', async ({
  page,
}) => {
  await createDocument(page);
  await toolbarButton(page, 'Skica').click();
  const panel = sketchPanel(page, 'Skica 1');
  await expect(panel).toBeVisible();
  const status = panel.getByRole('status');

  // The list of the constraints is collapsed by default.
  await expect(constraintSection(panel)).toHaveJSProperty('open', false);

  // 1. A horizontal line away from the origin: two free points (4) minus horizontal = 3. Escape
  // ends the chain, a second Escape goes back to the select tool.
  await toolbarButton(page, 'Úsečka').click();
  await clickCanvas(page, -100, 60);
  await clickCanvas(page, 100, 60);
  await expect(status).toHaveText('Stupně volnosti: 3');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await moveOverCanvas(page, 0, -150);

  // 2. Nothing selected, nothing hovered: no glyph.
  const horizontal = glyph(page, 'Vodorovná');
  await expect(horizontal).toHaveCount(0);

  // 3. "Zobrazit vazby" shows the glyphs of all constraints without a selection; off again hides
  // them.
  const showAll = panel.getByRole('button', { name: 'Zobrazit vazby', exact: true });
  await expect(showAll).toHaveAttribute('aria-pressed', 'false');
  await showAll.click();
  await expect(showAll).toHaveAttribute('aria-pressed', 'true');
  await expect(horizontal).toBeVisible();
  await showAll.click();
  await expect(showAll).toHaveAttribute('aria-pressed', 'false');
  await expect(horizontal).toHaveCount(0);

  // 4. A click on the line selects it: its glyph shows, not selected.
  await clickCanvas(page, 0, 60);
  await expect(horizontal).toBeVisible();
  await expect(horizontal).toHaveAttribute('aria-pressed', 'false');

  // 5. The pointer over the glyph hovers its constraint (the glyph is highlighted too), a click
  // selects the constraint.
  await horizontal.hover();
  await expect(horizontal).toHaveClass(/\bhover\b/);
  await horizontal.click();
  await expect(horizontal).toHaveAttribute('aria-pressed', 'true');

  // 6. Delete removes the selected constraint: the glyph goes, the line has one more freedom.
  await page.keyboard.press('Delete');
  await expect(status).toHaveText('Stupně volnosti: 4');
  await expect(horizontal).toHaveCount(0);
  // 7. The console stays clean (fixtures).
});
