// The edit lock (spec 10, "Vestavěné akce"): nothing may change the document while it is open
// read-only (Q038) or while the feature dialog holds its transaction. The one place of the rule;
// the built-in actions, the Timeline and the Toolbar all read it from here.

import type { Observable, Unsubscribe } from '@/core';
import type { FeatureEditor } from './feature-editor';

export function createEditLock(deps: {
  readOnly: boolean;
  editor: FeatureEditor;
}): Observable<boolean> {
  const { readOnly, editor } = deps;
  const get = (): boolean => readOnly || editor.current.get() !== null;

  // Derived without an own subscription: nothing to dispose, each subscriber follows
  // editor.current and hears only a change of the lock itself.
  return Object.freeze({
    get,
    subscribe(fn: () => void): Unsubscribe {
      if (readOnly) return () => undefined;
      let last = get();
      return editor.current.subscribe(() => {
        const next = get();
        if (next === last) return;
        last = next;
        fn();
      });
    },
  });
}
