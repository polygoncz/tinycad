// Ring 3 – AppSession: composition root for the browser platform.
// Public API of app (spec 11, "Kompoziční kořen (app)"). Everything else in this folder is internal.

export { createDocumentList, openAppSession } from './browser';
export type { DocumentListOptions, OpenAppSessionOptions } from './browser';
export { BUILT_IN_PLUGINS } from './plugins';
export { BUILT_IN_OPERATION_TYPES } from './operation-types';
export type {
  AppSession,
  AppViewport,
  DocumentInfo,
  DownloadFile,
  KernelUiState,
  RegenUiState,
} from './app-session';
export type { ViewSettings } from './view-settings';
export type { PluginMessages } from '@/plugin-api';
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
