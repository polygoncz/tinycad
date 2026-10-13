import type { Brand } from '@/core';
import type { FeatureId } from './model';

// References from feature params to results of other features. Always names,
// never indices or kernel handles, so they survive regeneration (ADR 0007).

/** '<featureId>/body' or '<featureId>/body:<n>'. */
export type BodyId = Brand<string, 'BodyId'>;
/** Persistent topological name, see spec 08. */
export type TopoName = Brand<string, 'TopoName'>;

export interface BodyRef {
  readonly kind: 'body';
  readonly body: BodyId;
}

export interface TopoRef {
  readonly kind: 'topo';
  readonly body: BodyId;
  readonly name: TopoName;
}

/** A closed region of a sketch, see spec 12. */
export interface SketchRegionRef {
  readonly kind: 'region';
  readonly sketch: FeatureId;
  readonly region: string;
}

/** Any reference; `kind` tells which. */
export type EntityRef = BodyRef | TopoRef | SketchRegionRef;
