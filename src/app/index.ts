// Ring 3 – AppSession: composition root for the browser platform.
// Public API of app (spec 11, "Kompoziční kořen (app)"). Everything else in this folder is internal.

export { createAppSession } from './session';
export type { AppSession, AppSessionDeps, AppViewport, RegenUiState } from './session';
export type { KernelUiState } from './kernel-supervisor';
export type { PluginMessages } from '@/plugin-api';
