#include "tinycad/kernel/occt_kernel.hpp"

#include "guarded.hpp"
#include "operations.hpp"
#include "regions.hpp"
#include "shape_table.hpp"

// OcctKernel only delegates: every method runs the operation of its area (operations.hpp) in
// `try` and turns anything thrown into the error of its result (guarded.hpp), so the kernel never
// throws (decision N13). The OCCT signal handlers (OSD::SetSignal) are not installed: a C++
// exception from OCCT is enough, and a crash inside OCCT stays a crash of the process.

namespace tinycad::kernel {

using detail::currentError;

struct OcctKernel::Impl {
  detail::ShapeTable shapes;
};

OcctKernel::OcctKernel() : impl_(std::make_unique<Impl>()) {}

OcctKernel::~OcctKernel() = default;

KernelResult<ShapeResult> OcctKernel::makeBox(const BoxInput& p) {
  try {
    return detail::makeBoxShape(impl_->shapes, p);
  } catch (...) {
    return core::fail(currentError("makeBox"));
  }
}

KernelResult<ShapeResult> OcctKernel::makeCylinder(const CylinderInput& p) {
  try {
    return detail::makeCylinderShape(impl_->shapes, p);
  } catch (...) {
    return core::fail(currentError("makeCylinder"));
  }
}

KernelResult<ShapeResult> OcctKernel::transform(ShapeHandle shape, const Mat4& m) {
  try {
    return detail::transformShape(impl_->shapes, shape, m);
  } catch (...) {
    return core::fail(currentError("transform"));
  }
}

KernelResult<ShapeResult> OcctKernel::boolean(BooleanOp op, std::span<const ShapeHandle> targets,
                                              std::span<const ShapeHandle> tools) {
  try {
    return detail::booleanShape(impl_->shapes, op, targets, tools);
  } catch (...) {
    return core::fail(currentError("boolean"));
  }
}

KernelResult<ShapeResult> OcctKernel::makeFace(const FaceInput& p) {
  try {
    return detail::makeFaceShape(impl_->shapes, p);
  } catch (...) {
    return core::fail(currentError("makeFace"));
  }
}

KernelResult<ProfileRegions> OcctKernel::profileRegions(std::span<const ProfileCurve> curves) {
  try {
    return detail::profileRegionsOf(curves);
  } catch (...) {
    return core::fail(currentError("profileRegions"));
  }
}

KernelResult<ShapeResult> OcctKernel::extrude(ShapeHandle profile, const Vec3& direction,
                                              double distance) {
  try {
    return detail::extrudeShape(impl_->shapes, profile, direction, distance);
  } catch (...) {
    return core::fail(currentError("extrude"));
  }
}

KernelResult<ShapeResult> OcctKernel::revolve(ShapeHandle profile, const Axis& axis, double angle) {
  try {
    return detail::revolveShape(impl_->shapes, profile, axis, angle);
  } catch (...) {
    return core::fail(currentError("revolve"));
  }
}

KernelResult<ShapeResult> OcctKernel::fillet(ShapeHandle shape, std::span<const int> edges,
                                             double radius) {
  try {
    return detail::dressupShape(impl_->shapes, detail::Dressup::Fillet, shape, edges, radius);
  } catch (...) {
    return core::fail(currentError("fillet"));
  }
}

KernelResult<ShapeResult> OcctKernel::chamfer(ShapeHandle shape, std::span<const int> edges,
                                              double distance) {
  try {
    return detail::dressupShape(impl_->shapes, detail::Dressup::Chamfer, shape, edges, distance);
  } catch (...) {
    return core::fail(currentError("chamfer"));
  }
}

KernelResult<BoundingBox> OcctKernel::boundingBox(ShapeHandle shape) {
  try {
    return detail::boundingBoxOf(impl_->shapes.find(shape));
  } catch (...) {
    return core::fail(currentError("boundingBox"));
  }
}

KernelResult<TopologySummary> OcctKernel::topology(ShapeHandle shape) {
  try {
    return detail::topologyOf(impl_->shapes.find(shape));
  } catch (...) {
    return core::fail(currentError("topology"));
  }
}

KernelResult<std::string> OcctKernel::exportStep(std::span<const ShapeHandle> shapes) {
  try {
    return detail::exportStepOf(impl_->shapes, shapes);
  } catch (...) {
    return core::fail(currentError("exportStep"));
  }
}

KernelResult<MeshData> OcctKernel::tessellate(ShapeHandle shape, const MeshQuality& q) {
  try {
    return detail::tessellateEntry(impl_->shapes.find(shape), q);
  } catch (...) {
    return core::fail(currentError("tessellate"));
  }
}

KernelResult<void> OcctKernel::release(std::span<const ShapeHandle> handles) {
  try {
    impl_->shapes.release(handles);
    return {};
  } catch (...) {
    return core::fail(currentError("release"));
  }
}

std::size_t OcctKernel::liveHandleCount() const { return impl_->shapes.liveCount(); }

}  // namespace tinycad::kernel
