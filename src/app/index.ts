// Ring 3 – AppSession: composition root for the browser platform.
// Public API of app (spec 11, "Kompoziční kořen (app)"). Everything else in this folder is internal.

export { createAppSession } from './session';
export {
  createNewDocument,
  deleteDocument,
  importDocumentFile,
  listDocuments,
  openAppSession,
} from './browser';
export type { OpenAppSessionOptions } from './browser';
export { BUILT_IN_PLUGINS } from './plugins';
export { BUILT_IN_OPERATION_TYPES } from './operation-types';
export type { AppSession, AppSessionDeps, AppViewport, RegenUiState } from './session';
export type { KernelUiState } from './kernel-supervisor';
export type { DownloadFile } from './file-exporter';
export type { PluginMessages } from '@/plugin-api';
export type { DocumentInfo } from '@/persistence';
export type { OrbitMode, ViewCubeLabels } from '@/render';
