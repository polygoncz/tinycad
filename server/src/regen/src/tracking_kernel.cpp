// The tracked kernel (Q041, src/regen/tracking-kernel.ts): the kernel a builder gets in its
// BuildContext. Every handle of a successful ShapeResult goes into the set the Regenerator owns,
// so mark & sweep releases intermediate shapes and the shapes of a builder that failed later too.

#include "tinycad/regen/builder.hpp"

namespace tinycad::regen {

namespace {

/** Records the handle of a successful result; a kernel error passes through unchanged. */
kernel::KernelResult<kernel::ShapeResult> track(kernel::KernelResult<kernel::ShapeResult> result,
                                                OwnedHandles& owned) {
  if (result) owned.insert(result->shape);
  return result;
}

}  // namespace

TrackingKernel::TrackingKernel(kernel::ModelingKernel& kernel, OwnedHandles& owned)
    : kernel_(kernel), owned_(owned) {}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::makeBox(const kernel::BoxInput& p) {
  return track(kernel_.makeBox(p), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::makeCylinder(
    const kernel::CylinderInput& p) {
  return track(kernel_.makeCylinder(p), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::transform(ShapeHandle shape,
                                                                    const core::Mat4& m) {
  return track(kernel_.transform(shape, m), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::boolean(
    kernel::BooleanOp op, std::span<const ShapeHandle> targets,
    std::span<const ShapeHandle> tools) {
  return track(kernel_.boolean(op, targets, tools), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::makeFace(const kernel::FaceInput& p) {
  return track(kernel_.makeFace(p), owned_);
}

kernel::KernelResult<kernel::ProfileRegions> TrackingKernel::profileRegions(
    std::span<const kernel::ProfileCurve> curves) {
  // Data, no handle (spec 06 "Stav po M30"): nothing to own.
  return kernel_.profileRegions(curves);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::extrude(ShapeHandle profile,
                                                                  const Vec3& direction,
                                                                  double distance) {
  return track(kernel_.extrude(profile, direction, distance), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::revolve(ShapeHandle profile,
                                                                  const kernel::Axis& axis,
                                                                  double angle) {
  return track(kernel_.revolve(profile, axis, angle), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::fillet(ShapeHandle shape,
                                                                 std::span<const int> edges,
                                                                 double radius) {
  return track(kernel_.fillet(shape, edges, radius), owned_);
}

kernel::KernelResult<kernel::ShapeResult> TrackingKernel::chamfer(ShapeHandle shape,
                                                                  std::span<const int> edges,
                                                                  double distance) {
  return track(kernel_.chamfer(shape, edges, distance), owned_);
}

kernel::KernelResult<kernel::BoundingBox> TrackingKernel::boundingBox(ShapeHandle shape) {
  return kernel_.boundingBox(shape);
}

kernel::KernelResult<kernel::TopologySummary> TrackingKernel::topology(ShapeHandle shape) {
  return kernel_.topology(shape);
}

}  // namespace tinycad::regen
