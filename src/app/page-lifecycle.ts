// Saving when the page goes away (Q034, spec 01 "Kompoziční kořen"): the persistence service
// knows no DOM (ADR 0009), so app binds pagehide and visibilitychange (hidden) to its flush.
// Without it a reload right after a change can lose the last entries, still waiting for the
// delayed flush. Takes plain event targets, so it is tested in Node with fakes.

import type { Disposable } from '@/core';

export interface PageLifecycleDeps {
  /** window: fires pagehide (reload, navigation, closing the tab). */
  readonly page: EventTarget;
  /** document: fires visibilitychange; the last chance on mobile and when the tab is hidden. */
  readonly document: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  readonly flush: () => Promise<void>;
  /** Nobody awaits a flush started by the page, so its failure goes here. */
  readonly onError: (error: unknown) => void;
}

/** Flushes on pagehide and on visibilitychange to hidden until dispose. */
export function flushOnPageHide(deps: PageLifecycleDeps): Disposable {
  const { page, document } = deps;
  function flush(): void {
    deps.flush().catch(deps.onError);
  }
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') flush();
  }
  page.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      page.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
