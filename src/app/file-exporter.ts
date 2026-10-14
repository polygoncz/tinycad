// The FileExporter of interaction (spec 11, "Export a historie", M15): what the File actions
// export and how. STEP comes from the live kernel and the bodies of the last regeneration; the
// document file from the store, with its history. The file goes to the `download` port, which ui
// implements (app knows no DOM).

import type { Observable } from '@/core';
import type { BodyId, DocumentId, FeatureSchemaRegistry } from '@/document';
import type { FileExporter } from '@/interaction';
import type { ExchangeOps, ShapeHandle } from '@/kernel';
import type { OpHandlerRegistry } from '@/ops';
import { exportStoredDocument } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { bodiesOf } from '@/regen';
import type { RegenState } from '@/regen';
import { safeFileName } from './file-names';
import { describeLoadError } from './load-error';

/** M15: a file to download; ui implements the port (a Blob and <a download>). */
export interface DownloadFile {
  readonly name: string;
  readonly mime: string;
  readonly data: string | Uint8Array<ArrayBuffer>;
}

export function createFileExporter(deps: {
  /** The current name of the document, for the file name. */
  readonly name: () => string;
  /** RegenScheduler.busy: a regeneration is running or due. */
  readonly regenBusy: Observable<boolean>;
  /** The final state of the last finished regeneration (the one of the last RegenSnapshot). */
  readonly lastState: () => RegenState;
  /** KernelSupervisor.kernel(): the kernel the handles of lastState belong to. */
  readonly kernel: () => ExchangeOps | null;
  /** Writes the queue of the persistence; read-only: nothing. */
  readonly flush: () => Promise<void>;
  readonly store: DocumentStore;
  readonly docId: DocumentId;
  readonly schemas: FeatureSchemaRegistry;
  readonly handlers: OpHandlerRegistry;
  readonly download: (file: DownloadFile) => void;
}): FileExporter {
  /** Resolves once no regeneration is running or due. */
  function idle(): Promise<void> {
    if (!deps.regenBusy.get()) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = deps.regenBusy.subscribe(() => {
        if (deps.regenBusy.get()) return;
        unsubscribe();
        resolve();
      });
    });
  }

  return {
    async exportStep(bodies: readonly BodyId[]): Promise<void> {
      await idle();
      // Synchronously from here to the call: the kernel gets the export before any release of a
      // later regeneration (the worker handles messages in order, spec 11).
      const kernel = deps.kernel();
      if (kernel === null) throw new Error('No geometry kernel is running');
      const shapes = shapesOf(deps.lastState(), bodies);
      if (shapes.length === 0) throw new Error('None of the bodies to export exists');
      const data = await kernel.exportStep(shapes);
      deps.download({ name: `${safeFileName(deps.name())}.step`, mime: 'model/step', data });
    },

    async exportDocument(): Promise<void> {
      await deps.flush();
      const file = await exportStoredDocument(deps.store, deps.docId, {
        schemas: deps.schemas,
        handlers: deps.handlers,
      });
      if (!file.ok) {
        throw new Error(`Cannot export document '${deps.docId}': ${describeLoadError(file.error)}`);
      }
      deps.download({
        name: `${safeFileName(deps.name())}.tinycad.json`,
        mime: 'application/json',
        // Indented: diffs of exported files stay readable in git (spec 11).
        data: `${JSON.stringify(file.value, null, 2)}\n`,
      });
    },
  };
}

/** Handles of the bodies in the order of `bodies`; a body missing in the state is skipped. */
function shapesOf(state: RegenState, bodies: readonly BodyId[]): ShapeHandle[] {
  const byId = new Map(bodiesOf(state).map((body) => [body.id, body.shape]));
  return bodies.flatMap((id) => {
    const shape = byId.get(id);
    return shape === undefined ? [] : [shape];
  });
}
