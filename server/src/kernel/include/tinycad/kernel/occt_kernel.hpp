#pragma once

// The OCCT implementation of the GeometryKernel port (M42; src/kernel-occt in TS, spec 06
// "kernel-occt: architektura adaptéru"). OCCT types never appear in this header: the shape table
// (handle → ShapeEntry with TopoDS_Shape, the TopTools_IndexedMapOfShape of faces/edges/vertices
// and the edge roles of a makeFace result) lives in the private Impl (pimpl, RAII: destroying the
// kernel frees every shape).

#include <memory>

#include "tinycad/kernel/kernel.hpp"

namespace tinycad::kernel {

class OcctKernel final : public GeometryKernel {
 public:
  OcctKernel();
  ~OcctKernel() override;
  OcctKernel(const OcctKernel&) = delete;
  OcctKernel& operator=(const OcctKernel&) = delete;

  KernelResult<ShapeResult> makeBox(const BoxInput& p) override;
  KernelResult<ShapeResult> makeCylinder(const CylinderInput& p) override;
  KernelResult<ShapeResult> transform(ShapeHandle shape, const Mat4& m) override;
  KernelResult<ShapeResult> boolean(BooleanOp op, std::span<const ShapeHandle> targets,
                                    std::span<const ShapeHandle> tools) override;
  KernelResult<ShapeResult> makeFace(const FaceInput& p) override;
  KernelResult<ProfileRegions> profileRegions(std::span<const ProfileCurve> curves) override;
  KernelResult<ShapeResult> extrude(ShapeHandle profile, const Vec3& direction,
                                    double distance) override;
  KernelResult<ShapeResult> revolve(ShapeHandle profile, const Axis& axis, double angle) override;
  KernelResult<ShapeResult> fillet(ShapeHandle shape, std::span<const int> edges,
                                   double radius) override;
  KernelResult<ShapeResult> chamfer(ShapeHandle shape, std::span<const int> edges,
                                    double distance) override;
  KernelResult<BoundingBox> boundingBox(ShapeHandle shape) override;
  KernelResult<TopologySummary> topology(ShapeHandle shape) override;
  KernelResult<std::string> exportStep(std::span<const ShapeHandle> shapes) override;
  KernelResult<MeshData> tessellate(ShapeHandle shape, const MeshQuality& q) override;
  KernelResult<void> release(std::span<const ShapeHandle> handles) override;
  [[nodiscard]] std::size_t liveHandleCount() const override;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace tinycad::kernel
