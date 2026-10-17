#pragma once

// The GeometryKernel port in C++ (spec 06, ADR 0011, src/kernel/kernel.ts), segregated by
// capability like the TS interfaces. Differences to TS (decisions N10–N13 in
// docs/40-plan/Rozhodnutí nativního jádra.md):
//
// - SYNCHRONOUS. TS needed Promises because OCCT lived in a worker; here the kernel runs in the
//   calling thread. Every method returns KernelResult<T> and never throws: an OCCT exception or
//   any other unexpected exception becomes a KernelError (OperationFailed or Internal per method,
//   spec 06 Kontrakt). std::bad_alloc is the only exception that may pass.
// - NOT THREAD-SAFE. One instance = one caller at a time (like the single TS worker). The session
//   layer (M45) serializes calls per instance.
// - Inputs are values, read during the call and never kept (the "isolation" contract holds by
//   construction); results are fresh values.
// - The 2D-only methods (curveIntersections, curveSegment, filletArc, offsetCurves) live in
//   tinycad_geometry (M39), see profile.hpp.
// - ModelingKernel (what a feature builder may use, Q041) is defined HERE, not in regen: C++
//   interfaces are nominal, so the implementation has to inherit it.

#include <cstddef>
#include <span>
#include <string>
#include <vector>

#include "tinycad/core/math.hpp"
#include "tinycad/kernel/errors.hpp"
#include "tinycad/kernel/profile.hpp"
#include "tinycad/kernel/types.hpp"

namespace tinycad::kernel {

using core::Mat4;

struct BoxInput {
  /** Corner; AABB = [origin, origin + size]. */
  Vec3 origin{};
  /** Each component finite and > 0. */
  Vec3 size{};
};

struct CylinderInput {
  /** Centre of the base. */
  Vec3 base{};
  /** Need not be unit; length > 1e-9. */
  Vec3 axis{};
  double radius = 0;
  double height = 0;
};

/** A point and a direction (need not be unit). */
struct Axis {
  Vec3 origin{};
  Vec3 direction{};
};

enum class BooleanOp { Union, Subtract, Intersect };

class PrimitiveOps {
 public:
  virtual ~PrimitiveOps() = default;
  /** Roles face:top|bottom|front|back|left|right (+Z, −Z, −Y, +Y, −X, +X). */
  virtual KernelResult<ShapeResult> makeBox(const BoxInput& p) = 0;
  /** Roles face:bottom, face:top, face:side. */
  virtual KernelResult<ShapeResult> makeCylinder(const CylinderInput& p) = 0;
};

class TransformOps {
 public:
  virtual ~TransformOps() = default;
  /**
   * New shape = `shape` moved by the rigid motion m (isRigidMotion, transform.hpp); history input 0.
   * Carries the edge roles of a makeFace result over to the new handle.
   */
  virtual KernelResult<ShapeResult> transform(ShapeHandle shape, const Mat4& m) = 0;
};

class BooleanOps {
 public:
  virtual ~BooleanOps() = default;
  /**
   * One resulting shape (a compound of solids if need be); the inputs stay valid. History inputs
   * are [...targets, ...tools] in call order. No solid in the result → OperationFailed.
   */
  virtual KernelResult<ShapeResult> boolean(BooleanOp op, std::span<const ShapeHandle> targets,
                                            std::span<const ShapeHandle> tools) = 0;
};

class SketchOps {
 public:
  virtual ~SketchOps() = default;
  /** Planar face; roles edge:<id> for each curve with an id. Loop orientation arbitrary. */
  virtual KernelResult<ShapeResult> makeFace(const FaceInput& p) = 0;
  /** M30: regions bounded by the curves (spec 12 "Oblasti (profily)"). No handle. */
  virtual KernelResult<ProfileRegions> profileRegions(std::span<const ProfileCurve> curves) = 0;
};

class SweepOps {
 public:
  virtual ~SweepOps() = default;
  /**
   * Prism of the face `profile` along `direction` (normalized by the kernel) by `distance` > 0.
   * Roles face:start, face:end, face:side:<id>; history input 0 = the profile.
   */
  virtual KernelResult<ShapeResult> extrude(ShapeHandle profile, const Vec3& direction,
                                            double distance) = 0;
  /** Revolution about `axis` by 0 < angle ≤ 2π (right-hand rule); roles as extrude when present. */
  virtual KernelResult<ShapeResult> revolve(ShapeHandle profile, const Axis& axis,
                                            double angle) = 0;
};

class DressupOps {
 public:
  virtual ~DressupOps() = default;
  /** Fillet of the edges (edge indices of `shape`); an edge OCCT does not take → OperationFailed. */
  virtual KernelResult<ShapeResult> fillet(ShapeHandle shape, std::span<const int> edges,
                                           double radius) = 0;
  /** Symmetric chamfer of the edges by `distance`. */
  virtual KernelResult<ShapeResult> chamfer(ShapeHandle shape, std::span<const int> edges,
                                            double distance) = 0;
};

class QueryOps {
 public:
  virtual ~QueryOps() = default;
  virtual KernelResult<BoundingBox> boundingBox(ShapeHandle shape) = 0;
  /** Faces, edges and vertex count; the same indices as the mesh of the handle. */
  virtual KernelResult<TopologySummary> topology(ShapeHandle shape) = 0;
};

class ExchangeOps {
 public:
  virtual ~ExchangeOps() = default;
  /** A STEP file (AP214, mm) with all the shapes; the bytes of an ASCII text. */
  virtual KernelResult<std::string> exportStep(std::span<const ShapeHandle> shapes) = 0;
};

class MeshOps {
 public:
  virtual ~MeshOps() = default;
  virtual KernelResult<MeshData> tessellate(ShapeHandle shape, const MeshQuality& q) = 0;
};

class LifecycleOps {
 public:
  virtual ~LifecycleOps() = default;
  /**
   * Atomic: an unknown or released handle → UnknownHandle, the same handle twice → InvalidInput,
   * and then nothing is released. Empty = nothing.
   */
  virtual KernelResult<void> release(std::span<const ShapeHandle> handles) = 0;
  /** Created and not released handles; a failed operation creates none (leak tests, M43). */
  [[nodiscard]] virtual std::size_t liveHandleCount() const = 0;
};

/** The part of the kernel a feature builder may use (regen ModelingKernel, Q041): never releases. */
class ModelingKernel : public PrimitiveOps,
                       public TransformOps,
                       public BooleanOps,
                       public SketchOps,
                       public SweepOps,
                       public DressupOps,
                       public QueryOps {};

class GeometryKernel : public ModelingKernel,
                       public ExchangeOps,
                       public MeshOps,
                       public LifecycleOps {};

}  // namespace tinycad::kernel
