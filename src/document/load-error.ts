// Why the data of a document could not be loaded (spec 03). The core loads and checks documents
// (an import refused with INVALID_DOCUMENT, spec 14); the client only shows the issues.

export interface DocumentLoadIssue {
  /** Where in the data, 'studio.features[3].id'. */
  readonly path: string;
  readonly message: string;
}

export interface DocumentLoadError {
  readonly issues: readonly DocumentLoadIssue[];
}
