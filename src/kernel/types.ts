import type { Brand, Vec3 } from '@/core';

// Values that cross the GeometryKernel port (spec 06): identity (handle) and plain data.

/**
 * Opaque id of a shape living inside the kernel. Positive integer, never reused within one
 * kernel instance, so a released handle always fails with 'unknown-handle'.
 */
export type ShapeHandle = Brand<number, 'ShapeHandle'>;

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MeshQuality {
  readonly linearDeflection: number;
  readonly angularDeflection: number;
}

export interface ShapeResult {
  readonly shape: ShapeHandle;
  /** Not filled until M14. */
  readonly history?: ShapeHistory;
  /** Named parts, e.g. { 'face:top': [5] }. Not filled until M14. */
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>;
}

/**
 * Index of a sub-shape = position in TopExp::MapShapes(shape, TopAbs_FACE/EDGE/VERTEX), from 0
 * (OCCT counts from 1, the adapter subtracts). Valid only for one handle.
 */
export interface SubShapeIndex {
  readonly type: 'face' | 'edge' | 'vertex';
  readonly index: number;
}

export interface ShapeHistory {
  /** For each input shape: sub-shape index in the input → sub-shape indices in the output. */
  readonly modified: readonly HistoryLink[];
  readonly generated: readonly HistoryLink[];
  readonly deleted: readonly { readonly input: number; readonly sub: SubShapeIndex }[];
}

export interface HistoryLink {
  readonly input: number;
  readonly from: SubShapeIndex;
  readonly to: readonly SubShapeIndex[];
}

/**
 * Flat typed arrays, so they can cross postMessage as transferables without copying. Each over
 * its own plain ArrayBuffer (not a SharedArrayBuffer, which cannot be transferred).
 */
export interface MeshData {
  /** xyz */
  readonly positions: Float32Array<ArrayBuffer>;
  /** xyz, unit length, one per vertex */
  readonly normals: Float32Array<ArrayBuffer>;
  /** Triangles, counter-clockwise when viewed from outside. */
  readonly indices: Uint32Array<ArrayBuffer>;
  /** Triangle ranges per B-rep face, for picking and face highlight: triples [faceIndex, firstTriangle, triangleCount]. */
  readonly faceRanges: Uint32Array<ArrayBuffer>;
  /** Edge polylines: points one after another. */
  readonly edgePositions: Float32Array<ArrayBuffer>;
  /** Triples [edgeIndex, firstPoint, pointCount]. */
  readonly edgeRanges: Uint32Array<ArrayBuffer>;
}
