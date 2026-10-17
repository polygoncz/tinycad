import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { confirmDialog, createDocument, fillParam, openTool, timelineFeature } from './helpers';

// Tabs and reloads against the core (M46, Q102, N70): a reload in the middle of work keeps what
// the core confirmed and the tab keeps the lock of the document (resume_session_id); a second tab
// of the same document is read-only and follows the changes of the first (WatchSession).

/** The tab may change the document: no read-only badge, the tools are enabled. */
async function expectWritable(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Kvádr', exact: true })).toBeEnabled();
  await expect(page.getByText('Jen pro čtení')).toHaveCount(0);
}

test('a reload in the middle of a dialog keeps the confirmed work and the lock', async ({
  page,
}) => {
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(page.getByText('Tělesa: 1')).toBeVisible();

  // A cylinder dialog open with a changed param: the transaction is open on the core.
  await openTool(page, 'Válec', 'Válec 1');
  await fillParam(page, 'Poloměr', '3');
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await page.reload();

  // The box is there, the cylinder of the open transaction is not, and the tab may write.
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(timelineFeature(page, 'Válec 1')).toHaveCount(0);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectWritable(page);
});

test('a reload whose CloseSession got lost resumes the session and keeps the lock', async ({
  page,
}) => {
  // CloseSession of the page going away never reaches the core: the session keeps the lease, so
  // only resume_session_id from sessionStorage gives the reloaded tab the lock back (N70). The
  // call goes with keepalive while the page unloads, which page.route does not see, so the fetch
  // of the page drops it.
  // (globalThis: the e2e are typed for Node, whose fetch has the shape of the browser's.)
  await page.addInitScript(() => {
    const fetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/tinycad.v1.SessionService/CloseSession')) {
        return new Promise<Response>(() => undefined);
      }
      return fetch(input, init);
    };
  });
  await createDocument(page);
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  // A dialog open: the resumed session still has its transaction, which the new page aborts.
  await openTool(page, 'Válec', 'Válec 1');
  await fillParam(page, 'Poloměr', '3');
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
  await page.reload();
  await expect(timelineFeature(page, 'Kvádr 1')).toBeVisible();
  await expect(timelineFeature(page, 'Válec 1')).toHaveCount(0);
  await expect(page.getByText('Tělesa: 1')).toBeVisible();
  await expectWritable(page);

  // The resumed session writes.
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 2'));
  await expect(page.getByText('Tělesa: 2')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Uloženo' })).toBeVisible();
});

test('a second tab is read-only and follows the changes of the first', async ({
  page,
  context,
}) => {
  await createDocument(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByText('Jen pro čtení')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Kvádr', exact: true })).toBeDisabled();
  await expect(second.getByText('Tělesa: 0')).toBeVisible();

  // A box in the first tab shows up in the second.
  await confirmDialog(await openTool(page, 'Kvádr', 'Kvádr 1'));
  await expect(timelineFeature(second, 'Kvádr 1')).toBeVisible();
  await expect(second.getByText('Tělesa: 1')).toBeVisible();

  // So does undo.
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(timelineFeature(second, 'Kvádr 1')).toHaveCount(0);
  await expect(second.getByText('Tělesa: 0')).toBeVisible();
  await expectWritable(page);
});
