import type { Brand, Vec3 } from '@/core';

// What the client knows of the geometry kernel (spec 06, N122): the identity of a body mesh and
// plain data the read model and the view pass around. The kernel itself runs on the server.

/** Opaque id of a body mesh: a positive integer, never reused while the tab lives. */
export type ShapeHandle = Brand<number, 'ShapeHandle'>;

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MeshQuality {
  readonly linearDeflection: number;
  readonly angularDeflection: number;
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
