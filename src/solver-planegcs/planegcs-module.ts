// Loading the planegcs WASM module (ADR 0016). Internal to solver-planegcs: the only place with a
// type assertion for the package.

import { init_planegcs_module, type GcsSystemConstructor } from '@salusoft89/planegcs';

/** The part of the initialised Emscripten module the adapter uses. */
export interface PlanegcsModule {
  readonly GcsSystem: GcsSystemConstructor;
}

export interface LoadPlanegcsOptions {
  /** URL of planegcs.wasm. In Node omit it, the package finds the file itself. */
  readonly locateWasm?: () => string;
}

/** Emscripten module factory with the one option the adapter passes. */
type InitPlanegcs = (config?: {
  readonly locateFile?: (path: string, prefix: string) => string;
}) => Promise<PlanegcsModule>;

// The package ships no dist/planegcs_dist/planegcs.d.ts, so init_planegcs_module is `any`
// (ADR 0016, "Chybějící typy"). The local signature restores the types: GcsSystemConstructor
// comes from the package's own typed declarations, only the factory shape is asserted here.
const initPlanegcs = init_planegcs_module as InitPlanegcs;

/** Loads and initialises a new instance of the planegcs module (every call a fresh one). */
export function loadPlanegcs(opts: LoadPlanegcsOptions = {}): Promise<PlanegcsModule> {
  const { locateWasm } = opts;
  return initPlanegcs(locateWasm ? { locateFile: locateWasm } : {});
}
