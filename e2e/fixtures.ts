import { expect, test as base } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';

// Every e2e test fails on an error in the browser console or an uncaught exception, in every
// page of its context (spec 13). A console error is a bug unless it is known and listed here.

/**
 * Console errors that are known and accepted. Each entry needs a reason; keep the list short
 * and the patterns narrow (match the specific message, not a whole category).
 */
const IGNORED_CONSOLE_ERRORS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [];

function ignored(text: string): boolean {
  return IGNORED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(text));
}

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (page: Page): void => {
        page.on('console', (message: ConsoleMessage) => {
          if (message.type() === 'error' && !ignored(message.text())) {
            const { url } = message.location();
            errors.push(`console: ${message.text()}${url === '' ? '' : ` (${url})`}`);
          }
        });
        page.on('pageerror', (error) => {
          if (!ignored(error.message)) errors.push(`pageerror: ${error.message}`);
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
