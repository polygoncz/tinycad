// The read model → the ports of the view (replaces regen-pipeline on the server path, D3 of M19.1
// kept): meshes into VersionMeshes, viewport.syncLayers, then RegenStatusPort, the drawings of the
// sketches, RegenUiState, afterSync and the first fitAll; resolvePlane and planeOfSketch for the
// sketcher. M46 task 1 fixes the contract; task 4 implements it.

import type { Disposable, Observable, Plane } from '@/core';
import type { FeatureId, PlaneRef, TopoRef } from '@/document';
import type { RegenStatusPort } from '@/interaction';
import type { ReadModelData } from '@/remote';
import type { RegenPipelineDeps, RegenUiState } from './regen-pipeline';
import type { VersionMeshes } from './version-meshes';

export interface ReadModelViewDeps {
  readonly meshes: VersionMeshes;
  readonly viewport: RegenPipelineDeps['viewport'];
  /** The open feature dialog: with one the view shows the input of its feature (ADR 0025). */
  readonly features: RegenPipelineDeps['features'];
  /** The open sketch session: its sketch is drawn by the sketcher, not by the view. */
  readonly sketches: RegenPipelineDeps['sketches'];
  /** Changes queued and in flight (RemoteSession.pending): RegenUiState.busy. */
  readonly pending: Observable<number>;
  readonly afterSync: () => void;
  readonly reportError: (error: unknown) => void;
}

export interface ReadModelView extends RegenStatusPort, Disposable {
  readonly ui: Observable<RegenUiState>;
  /** A new read model; one of an older generation than the shown one is dropped. */
  show(readModel: ReadModelData): void;
  /** A plane of the final state by id, or the plane of a planar face of a body (facePlanes). */
  resolvePlane(ref: PlaneRef | TopoRef): Plane | undefined;
  /** The plane of the sketch of a feature in the final state. */
  planeOfSketch(featureId: FeatureId): Plane | undefined;
}

export function createReadModelView(deps: ReadModelViewDeps): ReadModelView {
  throw new Error('createReadModelView: not implemented (M46 task 4)', { cause: deps });
}
