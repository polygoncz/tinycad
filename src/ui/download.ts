import type { DownloadFile } from '@/app';

// Downloading a file (spec 11, "Komponenty", M15): app hands an exported file to its `download`
// port, ui implements it as a Blob behind a temporary <a download>. The browser functions are
// the parameter `env`, so the logic is tested in Node without a DOM.

/** What downloadFile needs of the browser. */
export interface DownloadEnv {
  createObjectURL(b: Blob): string;
  revokeObjectURL(u: string): void;
  /** Clicks a temporary link to `href` that downloads under `name`. */
  click(href: string, name: string): void;
  /** Runs `fn` later; the browser waits 1 s (Safari starts the download asynchronously). */
  later(fn: () => void): void;
}

/** How long the object URL lives after the click. */
const REVOKE_DELAY_MS = 1000;

const BROWSER_ENV: DownloadEnv = {
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => {
    URL.revokeObjectURL(u);
  },
  click(href, name) {
    const a = globalThis.document.createElement('a');
    a.href = href;
    a.download = name;
    a.style.display = 'none';
    globalThis.document.body.append(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
  },
  later(fn) {
    setTimeout(fn, REVOKE_DELAY_MS);
  },
};

/** Downloads `file`: a Blob of its type, a click on a link, the URL revoked later. */
export function downloadFile(file: DownloadFile, env: DownloadEnv = BROWSER_ENV): void {
  const url = env.createObjectURL(new Blob([file.data], { type: file.mime }));
  try {
    env.click(url, file.name);
  } finally {
    env.later(() => {
      env.revokeObjectURL(url);
    });
  }
}
