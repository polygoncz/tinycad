import { restartCore } from './core';
import { expect, test } from './fixtures';
import { confirmDialog, createDocument, fillParam, openTool, timelineFeature } from './helpers';

// M48 (N151, N152): the core restarts while a feature dialog has its transaction open on the
// server. The session meets the new process, opens a new session and the transaction is gone: the
// dialog closes and a toast says why, not the console (the fixture fails on any console error). Runs in the serial project `restart`: the restart ends the
// sessions of every test on the shared core.

const LOST = 'Server přerušil rozpracovanou úpravu. Dialog se zavřel a změna se neuložila.';

// While the core restarts, Envoy answers the stream of the session with 503 and the browser
// reports the failed request itself; the session opens it again (spec 14). Only that report.
test.use({
  allowedConsoleError:
    /^Failed to load resource: the server responded with a status of 503 \(.*\) \(http:\/\/[^ ]+\/tinycad\.v1\.SessionService\/WatchSession\)$/,
});

test('a restart of the core in the middle of a dialog: the dialog closes with a toast', async ({
  page,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();

  await timelineFeature(page, 'Kvádr 1').dblclick();
  const edit = page.getByRole('dialog', { name: 'Kvádr 1', exact: true });
  await expect(edit).toBeVisible();
  // The transaction is open on the server once the change is confirmed.
  await fillParam(page, 'Šířka', '20');
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();

  // The stream of the session notices the new process first (a new session, the transaction gone),
  // often before the restart command returns: the page is watched meanwhile, the warning stays
  // only 8 s.
  const restarted = restartCore();
  await expect(page.getByRole('status').filter({ hasText: LOST })).toBeVisible({
    timeout: 60_000,
  });
  await restarted;
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
});
