// The volume of a body for the regen cases (spec 13, Druhy případů › regen; Q110): the TS kernel
// over OCCT in WASM has no volume and the domain is frozen, so the recorder computes it from a
// fine mesh and the regen cases compare it with tolerance.relative 1e-3. Taken over from
// test/integration/extrude-scenario.test.ts.

import type { MeshData, MeshQuality } from '@/kernel';

/** The fine mesh of the volume (spec 13): linearDeflection 0.01, angularDeflection 0.05. */
export const FINE_MESH: MeshQuality = Object.freeze({
  linearDeflection: 0.01,
  angularDeflection: 0.05,
});

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
export function meshVolume(mesh: MeshData): number {
  const p = (i: number): readonly [number, number, number] => [
    mesh.positions[3 * i] ?? Number.NaN,
    mesh.positions[3 * i + 1] ?? Number.NaN,
    mesh.positions[3 * i + 2] ?? Number.NaN,
  ];
  let sum = 0;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const a = p(mesh.indices[3 * t] ?? Number.NaN);
    const b = p(mesh.indices[3 * t + 1] ?? Number.NaN);
    const c = p(mesh.indices[3 * t + 2] ?? Number.NaN);
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}
