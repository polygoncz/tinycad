import { expect, test as base } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';

// Every e2e test fails on an error in the browser console or an uncaught exception, in every
// page of its context (spec 13). A console error is a bug unless it is known and listed here, or
// a test that causes it on purpose allows it (allowedConsoleError).

/**
 * Console errors that are known and accepted. Each entry needs a reason; keep the list short
 * and the patterns narrow (match the specific message, not a whole category).
 */
const IGNORED_CONSOLE_ERRORS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [];

function ignored(text: string, allowed: RegExp | null): boolean {
  return (
    IGNORED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(text)) ||
    (allowed?.test(text) ?? false)
  );
}

export const test = base.extend<{
  /**
   * Console errors a test causes on purpose (test.use in its file), e.g. the browser's own report
   * of requests failing while the test holds the network offline. A narrow pattern only; it is
   * matched against the text followed by ` (<url>)` when the message has a URL.
   */
  allowedConsoleError: RegExp | null;
  consoleErrors: string[];
}>({
  allowedConsoleError: [null, { option: true }],
  consoleErrors: [
    async ({ context, allowedConsoleError }, use) => {
      const errors: string[] = [];
      const watch = (page: Page): void => {
        page.on('console', (message: ConsoleMessage) => {
          if (message.type() !== 'error') return;
          // The patterns see the text with the URL of the message: the browser's report of a
          // failed request names the request only there.
          const { url } = message.location();
          const report = `${message.text()}${url === '' ? '' : ` (${url})`}`;
          if (!ignored(report, allowedConsoleError)) errors.push(`console: ${report}`);
        });
        page.on('pageerror', (error) => {
          if (!ignored(error.message, allowedConsoleError))
            errors.push(`pageerror: ${error.message}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(errors);
      expect(errors, 'errors in the browser console').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
