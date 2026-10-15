// The File actions (spec 10, "Export: akce Soubor", M15): export STEP and export the document.
// When they are enabled and the running state are presentation logic, so they live here; what is
// exported and how the file is downloaded is done by app behind the FileExporter port, so
// interaction knows neither the kernel nor the DOM.

import { DisposableStore, ObservableValue } from '@/core';
import type { Disposable, Observable, Unsubscribe } from '@/core';
import type { BodyId } from '@/document';
import type { ActionRegistry } from './actions';
import type { BrowserModel } from './browser-model';
import { FILE_ACTION_IDS } from './constants';
import type { FeatureEditor } from './feature-dialog/feature-editor';
import type { Mode } from './mode';
import type { RegenStatusPort } from './regen-status-port';

/** Port: app exports and downloads the file; a rejection = the export failed. */
export interface FileExporter {
  exportStep(bodies: readonly BodyId[]): Promise<void>;
  /**
   * M19.1 (D4): `withHistory` is false when app had to export the live document without its edit
   * history, because the store could not take the work.
   */
  exportDocument(): Promise<{ readonly withHistory: boolean }>;
}

export type FileTask = 'step' | 'document';

/** The translation key of the warning of a finished export (M19.1). */
type FileWarning = 'file.exportedWithoutHistory';

export type FileStatus =
  /** warning: the last export finished, but the file lacks something; ui shows the key. */
  | { readonly kind: 'idle'; readonly warning: FileWarning | null }
  | { readonly kind: 'running'; readonly task: FileTask }
  /** message is technical; ui shows it in a tooltip. */
  | { readonly kind: 'failed'; readonly task: FileTask; readonly message: string };

export interface FileActions extends Disposable {
  readonly status: Observable<FileStatus>;
  /** 'failed' or 'idle' with a warning → 'idle' without one, otherwise nothing. */
  dismiss(): void;
}

/** The group of the File menu in the TitleBar. */
const FILE_GROUP = 'file';

const MODEL_ONLY: readonly Mode[] = Object.freeze(['model']);

const IDLE: FileStatus = Object.freeze({ kind: 'idle', warning: null });

const EXPORTED_WITHOUT_HISTORY: FileStatus = Object.freeze({
  kind: 'idle',
  warning: 'file.exportedWithoutHistory',
});

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Registers the File actions into `deps.registry`. dispose unsubscribes the `enabled`
 * observables from their sources; the registry itself is disposed by its owner.
 */
export function createFileActions(deps: {
  registry: ActionRegistry;
  exporter: FileExporter;
  regen: RegenStatusPort;
  browser: Pick<BrowserModel, 'hidden'>;
  editor: Pick<FeatureEditor, 'current'>;
  mode: Observable<Mode>;
}): FileActions {
  const { registry, exporter, regen, browser, editor, mode } = deps;
  const subscriptions = new DisposableStore();
  const status = new ObservableValue<FileStatus>(IDLE);

  /** An Observable<boolean> recomputed whenever one of the sources fires. */
  function derived(
    compute: () => boolean,
    sources: readonly Observable<unknown>[],
  ): Observable<boolean> {
    const value = new ObservableValue(compute());
    const recompute = (): void => {
      value.set(compute());
    };
    for (const source of sources) subscriptions.add<Unsubscribe>(source.subscribe(recompute));
    return value.asObservable();
  }

  const isRunning = (): boolean => status.get().kind === 'running';

  /** Bodies of the last regeneration not hidden in the browser, in the order of the snapshot. */
  function visibleBodies(): BodyId[] {
    const hidden = browser.hidden.get();
    return regen.state.get().bodies.flatMap(({ body }) => (hidden.has(body) ? [] : [body]));
  }

  /**
   * Runs one export: running → idle when it settles (with the status `run` resolves with), failed
   * when it rejects.
   */
  function start(task: FileTask, run: () => Promise<FileStatus>): void {
    if (isRunning()) return;
    status.set(Object.freeze({ kind: 'running', task }));
    let promise: Promise<FileStatus>;
    try {
      promise = run();
    } catch (e) {
      promise = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    promise.then(
      (done) => {
        status.set(done);
      },
      (e: unknown) => {
        status.set(Object.freeze({ kind: 'failed', task, message: messageOf(e) }));
      },
    );
  }

  registry.register({
    id: FILE_ACTION_IDS.exportStep,
    label: FILE_ACTION_IDS.exportStep,
    group: FILE_GROUP,
    modes: MODEL_ONLY,
    enabled: derived(
      () =>
        !isRunning() &&
        editor.current.get() === null &&
        mode.get() === 'model' &&
        visibleBodies().length > 0,
      [status, editor.current, mode, regen.state, browser.hidden],
    ),
    run: () => {
      const bodies = visibleBodies();
      start('step', async () => {
        await exporter.exportStep(bodies);
        return IDLE;
      });
    },
  });

  registry.register({
    id: FILE_ACTION_IDS.exportDocument,
    label: FILE_ACTION_IDS.exportDocument,
    group: FILE_GROUP,
    modes: MODEL_ONLY,
    enabled: derived(() => !isRunning(), [status]),
    run: () => {
      start('document', async () => {
        const { withHistory } = await exporter.exportDocument();
        return withHistory ? IDLE : EXPORTED_WITHOUT_HISTORY;
      });
    },
  });

  return {
    status: status.asObservable(),
    dismiss() {
      const current = status.get();
      if (current.kind === 'failed' || (current.kind === 'idle' && current.warning !== null)) {
        status.set(IDLE);
      }
    },
    dispose() {
      subscriptions.dispose();
    },
  };
}
