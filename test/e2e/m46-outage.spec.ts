import { expect, test } from './fixtures';
import {
  canvasPoint,
  confirmDialog,
  createDocument,
  createExtrudedBlock,
  extrudeArrowGrip,
  paramInput,
  reloadWhenSaved,
  timelineFeature,
} from './helpers';

// The connection drops for 2 s in the middle of a drag (M46): the session repeats the changes
// with the same operation_id (N86), the title bar says it is reconnecting, and once the network
// is back the value of the release is what the core stores.

const OUTAGE_MS = 2000;

// The browser itself reports every request that fails while the network is away (Chrome,
// WebKit); the session repeats them (N86).
test.use({
  allowedConsoleError:
    /^Failed to load resource: (?:net::ERR_INTERNET_DISCONNECTED|WebKit encountered an internal error)$/,
});

test('a 2 s outage during a drag: reconnecting is shown, the released value is stored', async ({
  page,
  context,
}) => {
  await createDocument(page);
  await createExtrudedBlock(page);
  await timelineFeature(page, 'Vysunutí 1').dblclick();
  const edit = page.getByRole('dialog', { name: 'Vysunutí 1', exact: true });
  await expect(edit).toBeVisible();

  const [gx, gy] = await extrudeArrowGrip(page);
  const [x, y] = await canvasPoint(page, [gx, gy]);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 10 });

  // Offline: the changes of the drag go on, fail and wait for their next attempt.
  await context.setOffline(true);
  await page.mouse.move(x, y - 60, { steps: 10 });
  await expect(page.getByText('Spojení se serverem přerušeno, obnovuji spojení…')).toBeVisible();
  await page.waitForTimeout(OUTAGE_MS);
  await context.setOffline(false);

  await page.mouse.move(x, y - 90, { steps: 10 });
  await page.mouse.up();
  const field = paramInput(page, 'Vzdálenost');
  const released = await field.inputValue();
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await expect(page.getByText('Spojení se serverem přerušeno, obnovuji spojení…')).toHaveCount(0);
  await expect(field).toHaveValue(released);
  await confirmDialog(edit);

  await reloadWhenSaved(page);
  await timelineFeature(page, 'Vysunutí 1').dblclick();
  await expect(paramInput(page, 'Vzdálenost')).toHaveValue(released);
  await page.getByRole('dialog').getByRole('button', { name: 'Zrušit', exact: true }).click();
});
