// Ring 3 – AppSession: composition root for the browser platform.
// Public API of app (spec 11, "Kompoziční kořen (app)"). Everything else in this folder is internal.

export { createAppSession } from './session';
export { createDocumentList, openAppSession, openBrowserMigration } from './browser';
export type {
  BrowserMigrationOptions,
  DocumentListOptions,
  OpenAppSessionOptions,
} from './browser';
// M46 (N71): the move of the documents of IndexedDB to the core, for the start screen.
export type { BrowserMigration, MigrationFailure, MigrationReport } from './browser-migration';
export { BUILT_IN_PLUGINS } from './plugins';
export { BUILT_IN_OPERATION_TYPES } from './operation-types';
export type { AppSession, AppSessionDeps, AppViewport } from './session';
export type { RegenUiState } from './regen-pipeline';
export type { ViewSettings } from './view-settings';
export type { KernelUiState, SupervisedKernel } from './kernel-supervisor';
export type { DownloadFile } from './file-exporter';
export type { PluginMessages } from '@/plugin-api';
export type { DocumentInfo } from '@/persistence';
export {
  AO_SETTING_RANGES,
  DEFAULT_AO_SETTINGS,
  DEFAULT_DISPLAY_STYLE,
  DISPLAY_MODES,
  displayDrawsAo,
  isValidAoSetting,
} from '@/render';
export type {
  AoSettingRange,
  AoSettings,
  DisplayMode,
  DisplayStyle,
  OrbitMode,
  ViewCubeLabels,
} from '@/render';
export type { HandleUnit, HudField, ManipulatorHud } from '@/interaction';
// M24: the material presets of bodies for the material select of the browser (spec 11).
export type { BodyMaterial } from '@/interaction';
export { BODY_MATERIALS, DEFAULT_BODY_MATERIAL } from '@/interaction';
