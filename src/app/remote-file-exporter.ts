// The FileExporter of interaction over the core (spec 11 "Export a historie", spec 14): the same
// port createFileActions uses today. Both files come from the server once the queue of changes is
// empty, so they hold everything the user did: STEP of the visible bodies of the final state
// (ExportStep) and the document file with its history (ExportDocument; the server keeps the log,
// so there is no export without history any more, M19.1 D4). The file goes to `download`.

import type { DocumentId } from '@/document';
import type { FileExporter } from '@/interaction';
import type { RemoteDocuments, RemoteSession } from '@/remote';
import type { DownloadFile } from './app-session';
import { queueEmpty } from './queue-empty';

export interface RemoteFileExporterDeps {
  readonly session: Pick<RemoteSession, 'pending' | 'exportStep'>;
  readonly documents: Pick<RemoteDocuments, 'exportFile'>;
  readonly docId: DocumentId;
  readonly download: (file: DownloadFile) => void;
}

export function createRemoteFileExporter(deps: RemoteFileExporterDeps): FileExporter {
  return {
    // The server exports the visible bodies of its final state (spec 14): the bodies the File
    // actions list are those too, read from the same read model.
    async exportStep(): Promise<void> {
      await queueEmpty(deps.session.pending);
      const { content, fileName } = await deps.session.exportStep();
      deps.download({ name: fileName, mime: 'model/step', data: ownBytes(content) });
    },

    async exportDocument(): Promise<{ readonly withHistory: boolean }> {
      await queueEmpty(deps.session.pending);
      const { content, fileName } = await deps.documents.exportFile(deps.docId);
      deps.download({ name: fileName, mime: 'application/json', data: ownBytes(content) });
      return { withHistory: true };
    },
  };
}

/** A copy over its own ArrayBuffer, as DownloadFile wants (a decoded `bytes` may be a view). */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
