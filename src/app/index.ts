// Ring 3 – AppSession: composition root for the browser platform.
// Public API of app (spec 11, "Kompoziční kořen (app)"). Everything else in this folder is internal.

export { createAppSession } from './session';
export { createDocumentList, openAppSession } from './browser';
export type { DocumentListOptions, OpenAppSessionOptions } from './browser';
export { BUILT_IN_PLUGINS } from './plugins';
export { BUILT_IN_OPERATION_TYPES } from './operation-types';
export type { AppSession, AppSessionDeps, AppViewport } from './session';
export type { RegenUiState } from './regen-pipeline';
export type { ViewSettings } from './view-settings';
export type { KernelUiState, SupervisedKernel } from './kernel-supervisor';
export type { DownloadFile } from './file-exporter';
export type { PluginMessages } from '@/plugin-api';
export type { DocumentInfo } from '@/persistence';
export type { OrbitMode, ViewCubeLabels } from '@/render';
export type { HandleUnit, HudField, ManipulatorHud } from '@/interaction';
