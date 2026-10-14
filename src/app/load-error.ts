// Text of a LoadDocumentError for an Error message: opening a session and exporting the stored
// document (M15) report it the same way.

import type { LoadDocumentError } from '@/persistence';

export function describeLoadError(error: LoadDocumentError): string {
  switch (error.kind) {
    case 'not-found':
      return 'not found';
    case 'snapshot':
      return `broken ${error.which} snapshot: ${error.error.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`;
    case 'entry':
      return `broken log entry ${String(error.seq)}: ${error.error.path}: ${error.error.message}`;
  }
}
