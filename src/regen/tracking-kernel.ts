import type { ShapeHandle, ShapeResult } from '@/kernel';
import type { ModelingKernel } from './builder';

// Tracked kernel (Q041): the kernel a builder gets in BuildContext. It records every handle the
// real kernel returns into a set owned by the Regenerator, so mark & sweep releases also
// intermediate shapes and shapes of a builder that failed afterwards.
//
// It is only a ModelingKernel: release and liveHandleCount are not there, so the type keeps a
// builder from releasing handles (spec 07). The object literal is typed ModelingKernel, so a new
// operation group added to ModelingKernel does not compile until it is written here – a method
// returning ShapeResult must then go through `track`.

/** Wraps `kernel`; every returned handle is added to `owned` as soon as the call resolves. */
export function createTrackingKernel(
  kernel: ModelingKernel,
  owned: Set<ShapeHandle>,
): ModelingKernel {
  // Kernel rejections pass through unchanged, so kernelErrorCode still recognises them.
  const track = (result: ShapeResult): ShapeResult => {
    owned.add(result.shape);
    return result;
  };
  return {
    makeBox: (p) => kernel.makeBox(p).then(track),
    makeCylinder: (p) => kernel.makeCylinder(p).then(track),
    transform: (shape, m) => kernel.transform(shape, m).then(track),
    boolean: (op, targets, tools) => kernel.boolean(op, targets, tools).then(track),
    makeFace: (p) => kernel.makeFace(p).then(track),
    extrude: (profile, direction, distance) =>
      kernel.extrude(profile, direction, distance).then(track),
    revolve: (profile, axis, angle) => kernel.revolve(profile, axis, angle).then(track),
    boundingBox: (shape) => kernel.boundingBox(shape),
  };
}
