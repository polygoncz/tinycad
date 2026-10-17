#pragma once

// The behaviour half of a feature type (spec 07 "Builder featury", ADR 0004, src/regen/builder.ts
// and build-context.ts): turns evaluated params into geometry. The data half is
// document::FeatureSchema (M40).
//
// Differences to TS (decision N40):
// - SYNCHRONOUS like the kernel (N13). build() returns core::Result<BuildOutput, FeatureError>.
// - A kernel error is a value, not an exception: a builder forwards it with
//   `return core::fail(kernelFailure(r.error()));` (the KERNEL status of spec 07) or converts it
//   itself (fillet.failed, chamfer.failed, extrude.upToFace). An exception out of build() is a
//   programmer error (Q043): Regenerator::run sweeps and rethrows it.
// - BuildContext is a concrete class (one per build, created by the Regenerator; tests create it
//   directly). Its kernel() is the tracking kernel: every handle it returns belongs to the
//   Regenerator (Q041), so a builder never releases anything and the type has no release.

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/names.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

using document::EntityRef;

// =============================================================================================
// Anchors (spec 07 "Kotvy manipulátorů", M18, ADR 0021)

/** A point and an optional unit direction in world coordinates. */
struct Anchor {
  Vec3 point{};
  std::optional<Vec3> direction;
  friend bool operator==(const Anchor&, const Anchor&) = default;
};

/** Anchors of one feature by name ('pivot', 'base'); {} for a feature without a manipulator. */
using FeatureAnchors = std::map<std::string, Anchor>;

// =============================================================================================
// Resolving references

/** The first reference a resolve method could not find (Q044); message for logs only. */
struct RefError {
  EntityRef ref;
  std::string message;
};

/**
 * The feature error for an unresolved reference of the param `param` (Q044):
 * { UNRESOLVED_REFERENCE, e.message, [{ param, "param.unresolvedRef" }] }.
 */
FeatureError unresolvedReference(std::string_view param, const RefError& e);

/**
 * The KERNEL feature error of a kernel failure (D9 of M19.2): one issue { "", code } with code
 * "kernel.operationFailed" (OperationFailed), "kernel.invalidInput" (InvalidInput) or
 * "kernel.internal" (anything else); the message of the KernelError.
 */
FeatureError kernelFailure(const kernel::KernelError& e);

/** A region of a sketch (M13): its artifact and its planar face. */
struct ResolvedRegion {
  EntityRef ref;
  SketchArtifactPtr sketch;
  ShapeHandle face{};
};

/** An axis in world coordinates (M13). */
struct ResolvedAxis {
  Vec3 origin{};
  /** Unit. */
  Vec3 direction{};
};

/** The plane of a plane artifact, or the sketch frame of a planar body face (M14, face_plane.hpp). */
struct ResolvedPlane {
  EntityRef ref;
  Plane plane;
};

/** Faces or edges of a body found by name (M14): indices ascending, at least one. */
struct ResolvedTopo {
  EntityRef ref;
  BodyPtr body;
  std::vector<int> indices;
};

enum class TopoKind { Face, Edge };

/** Handles the Regenerator owns (Q041); the tracking kernel adds to it. */
using OwnedHandles = std::set<ShapeHandle>;

/**
 * The kernel a builder gets (Q041, src/regen/tracking-kernel.ts): forwards every ModelingKernel
 * call to the real kernel and adds every handle of a successful ShapeResult to `owned`. Data
 * calls (profileRegions, boundingBox, topology) pass through. It has no release by type.
 */
class TrackingKernel final : public kernel::ModelingKernel {
 public:
  TrackingKernel(kernel::ModelingKernel& kernel, OwnedHandles& owned);

  kernel::KernelResult<kernel::ShapeResult> makeBox(const kernel::BoxInput& p) override;
  kernel::KernelResult<kernel::ShapeResult> makeCylinder(const kernel::CylinderInput& p) override;
  kernel::KernelResult<kernel::ShapeResult> transform(ShapeHandle shape,
                                                      const core::Mat4& m) override;
  kernel::KernelResult<kernel::ShapeResult> boolean(kernel::BooleanOp op,
                                                    std::span<const ShapeHandle> targets,
                                                    std::span<const ShapeHandle> tools) override;
  kernel::KernelResult<kernel::ShapeResult> makeFace(const kernel::FaceInput& p) override;
  kernel::KernelResult<kernel::ProfileRegions> profileRegions(
      std::span<const kernel::ProfileCurve> curves) override;
  kernel::KernelResult<kernel::ShapeResult> extrude(ShapeHandle profile, const Vec3& direction,
                                                    double distance) override;
  kernel::KernelResult<kernel::ShapeResult> revolve(ShapeHandle profile, const kernel::Axis& axis,
                                                    double angle) override;
  kernel::KernelResult<kernel::ShapeResult> fillet(ShapeHandle shape, std::span<const int> edges,
                                                   double radius) override;
  kernel::KernelResult<kernel::ShapeResult> chamfer(ShapeHandle shape, std::span<const int> edges,
                                                    double distance) override;
  kernel::KernelResult<kernel::BoundingBox> boundingBox(ShapeHandle shape) override;
  kernel::KernelResult<kernel::TopologySummary> topology(ShapeHandle shape) override;

 private:
  kernel::ModelingKernel& kernel_;
  OwnedHandles& owned_;
};

/**
 * BuildContext of one feature build (spec 07). Every resolve method looks only at the input
 * state and only at artifacts of its kind; the first unresolved reference is the error.
 */
class BuildContext {
 public:
  /** `kernel` is the real kernel; the context wraps it in a TrackingKernel over `owned`. */
  BuildContext(kernel::ModelingKernel& kernel, OwnedHandles& owned, StatePtr state);

  /** The tracking kernel. */
  [[nodiscard]] kernel::ModelingKernel& kernel();
  [[nodiscard]] const StatePtr& state() const;

  /** Body refs → bodies of the input state; a missing id or another kind → err. */
  core::Result<std::vector<BodyPtr>, RefError> resolveBodies(const std::vector<EntityRef>& refs);
  /**
   * Plane or Topo refs → planes. A plane artifact, or a planar body face (spec 08): the face with
   * the smallest index of the name (several → warn "… the first is used"); non-planar → err.
   */
  core::Result<std::vector<ResolvedPlane>, RefError> resolvePlanes(
      const std::vector<EntityRef>& refs);
  /** Region refs → the artifact sketchId(ref.sketch) of kind sketch and the face of the name. */
  core::Result<std::vector<ResolvedRegion>, RefError> resolveRegions(
      const std::vector<EntityRef>& refs);
  /**
   * An Axis ref (artifact of kind axis) or a SketchEntity ref (a line of the sketch, construction
   * too, through the sketch plane into world coordinates). Not a line, or length ≤ 1e-9 (EPSILON of src/core) → err.
   */
  core::Result<ResolvedAxis, RefError> resolveAxis(const EntityRef& ref);
  /**
   * Topo refs → faces or edges by name, in the order of refs: no match → err; several faces warn
   * "… all are used" and are all used; several edges are all used without a warning.
   */
  core::Result<std::vector<ResolvedTopo>, RefError> resolveTopo(const std::vector<EntityRef>& refs,
                                                                TopoKind kind);
  /** Several calls are joined with '\n' into one 'warning' status (Q045). */
  void warn(std::string message);

  /** The messages of warn joined with '\n' in call order; nullopt when none. */
  [[nodiscard]] std::optional<std::string> warnings() const;

 private:
  TrackingKernel tracking_;
  StatePtr state_;
  std::vector<std::string> messages_;
};

// =============================================================================================
// FeatureBuilder

/** Since M20 the builder gets only evaluated params, never raw ones (spec 07). */
struct BuildInput {
  /** The feature: id, type, version, name. Its `params` are NOT read; use `params` below. */
  const document::FeatureInstance& feature;
  /** document::evaluateParams(schema, feature.params).params: evaluated and valid. */
  const core::Json& params;
  /** State before this feature. */
  StatePtr state;
};

struct BuildOutput {
  StatePtr state;
  FeatureAnchors anchors;
};

using BuildResult = core::Result<BuildOutput, FeatureError>;

/**
 * Rules (spec 07): never change the input state, return a new one (RegenState::with,
 * replaceBodies, applyBodyOperation); keep the identity of artifacts (ADR 0015; modifyBody);
 * never release handles; create every shape through ctx.kernel(); return expected failures as
 * errors (unresolvedReference, kernelFailure or the builder's own INVALID_PARAMS issues).
 * Stateless: one instance serves every feature of its type.
 */
class FeatureBuilder {
 public:
  virtual ~FeatureBuilder() = default;
  /** Registry key, the same as FeatureSchema::type(). */
  [[nodiscard]] virtual const std::string& type() const = 0;
  virtual BuildResult build(const BuildInput& input, BuildContext& ctx) const = 0;
};

using FeatureBuilderPtr = std::shared_ptr<const FeatureBuilder>;

/** The read role of the builder registry. */
class FeatureBuilderRegistryReader {
 public:
  virtual ~FeatureBuilderRegistryReader() = default;
  /** nullptr for an unknown type. */
  [[nodiscard]] virtual const FeatureBuilder* find(std::string_view type) const = 0;
  /** In registration order. */
  [[nodiscard]] virtual std::vector<const FeatureBuilder*> all() const = 0;
};

class FeatureBuilderRegistry final : public FeatureBuilderRegistryReader {
 public:
  /** Throws core::AssertionError for a null builder or a duplicate type. */
  void add(FeatureBuilderPtr builder);
  [[nodiscard]] const FeatureBuilder* find(std::string_view type) const override;
  [[nodiscard]] std::vector<const FeatureBuilder*> all() const override;

 private:
  std::vector<FeatureBuilderPtr> builders_;
};

}  // namespace tinycad::regen
