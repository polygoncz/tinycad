#pragma once

// Test helpers of regen (the C++ twin of src/regen/testing.ts, decision N45): a counting kernel
// decorator over the real OcctKernel with injected failures, a test feature type (schema + spy
// builder), sketch artifacts, build contexts and hand-written name tables. Test-only.

#include <gtest/gtest.h>

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <ostream>
#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/kernel/occt_kernel.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/regen/names.hpp"
#include "tinycad/regen/regenerator.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

inline void PrintTo(FeatureStatusKind kind, std::ostream* os) {
  *os << featureStatusKindName(kind);
}
inline void PrintTo(FeatureErrorCode code, std::ostream* os) { *os << featureErrorCodeName(code); }

}  // namespace tinycad::regen

namespace tinycad::regen::test {

using core::Json;
using document::FeatureId;
using document::FeaturePtr;
using kernel::ShapeHandle;

/** Feature ids in tests are plain strings. */
inline FeatureId fid(const std::string& id) { return FeatureId(id); }

// =============================================================================================
// CountingKernel

/**
 * A GeometryKernel decorator over its own OcctKernel (N45): counts every call by method name
 * ("makeBox", "topology", "release", …) and fails the next call of a method on demand.
 */
class CountingKernel final : public kernel::GeometryKernel {
 public:
  CountingKernel() = default;

  /** Calls of one method so far. */
  [[nodiscard]] int calls(const std::string& method) const;
  /** Calls of every method except release (what a builder or the Regenerator asked the kernel). */
  [[nodiscard]] int modelingCalls() const;
  /** Calls by method name so far (the table of the measurement, RegenerationMeasure). */
  [[nodiscard]] const std::map<std::string, int>& counts() const { return counts_; }
  void resetCounts() {
    counts_.clear();
    booleanCalls_.clear();
  }
  /** The next call of `method` returns `error` without reaching OCCT. */
  void failNext(const std::string& method, kernel::KernelError error);
  /** One boolean call as the kernel got it. */
  struct BooleanCall {
    kernel::BooleanOp op;
    std::vector<ShapeHandle> targets;
    std::vector<ShapeHandle> tools;
    friend bool operator==(const BooleanCall&, const BooleanCall&) = default;
  };
  /** Every boolean call so far, in call order. */
  [[nodiscard]] const std::vector<BooleanCall>& booleanCalls() const { return booleanCalls_; }
  /** The real kernel underneath (to make shapes the counts must not see). */
  kernel::OcctKernel& occt() { return occt_; }

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
  kernel::KernelResult<kernel::ShapeResult> extrude(ShapeHandle profile,
                                                    const core::Vec3& direction,
                                                    double distance) override;
  kernel::KernelResult<kernel::ShapeResult> revolve(ShapeHandle profile, const kernel::Axis& axis,
                                                    double angle) override;
  kernel::KernelResult<kernel::ShapeResult> fillet(ShapeHandle shape, std::span<const int> edges,
                                                   double radius) override;
  kernel::KernelResult<kernel::ShapeResult> chamfer(ShapeHandle shape, std::span<const int> edges,
                                                    double distance) override;
  kernel::KernelResult<kernel::BoundingBox> boundingBox(ShapeHandle shape) override;
  kernel::KernelResult<kernel::TopologySummary> topology(ShapeHandle shape) override;
  kernel::KernelResult<std::string> exportStep(std::span<const ShapeHandle> shapes) override;
  kernel::KernelResult<kernel::MeshData> tessellate(ShapeHandle shape,
                                                    const kernel::MeshQuality& q) override;
  kernel::KernelResult<void> release(std::span<const ShapeHandle> handles) override;
  [[nodiscard]] std::size_t liveHandleCount() const override;

 private:
  /** Counts the call; the injected failure of the method, if any (consumed). */
  std::optional<kernel::KernelError> enter(const std::string& method);

  kernel::OcctKernel occt_;
  std::map<std::string, int> counts_;
  std::map<std::string, kernel::KernelError> failures_;
  std::vector<BooleanCall> booleanCalls_;
};

// =============================================================================================
// The test feature type

/** Validation of the default test schema: { size } with size > 0 (validateSize). */
std::vector<document::ParamIssue> validateSize(const Json& params);

/** A schema of `type` for the params { size } of aFeature(); `version` 1 by default. */
class TestSchema final : public document::FeatureSchema {
 public:
  using Validate = std::function<std::vector<document::ParamIssue>(const Json&)>;
  explicit TestSchema(std::string type = "box", Validate validate = validateSize, int version = 1);

  [[nodiscard]] const std::string& type() const override { return type_; }
  [[nodiscard]] int version() const override { return version_; }
  [[nodiscard]] const std::string& label() const override { return type_; }
  [[nodiscard]] const std::string& icon() const override { return icon_; }
  [[nodiscard]] const document::ParamSchema& params() const override { return params_; }
  [[nodiscard]] Json defaults() const override { return Json{{"size", 1}}; }
  [[nodiscard]] std::vector<document::ParamIssue> validate(const Json& params) const override {
    return validate_(params);
  }
  /** Lets version() > 1 into a registry; never called by regen. */
  [[nodiscard]] bool hasMigrate() const override { return true; }

 private:
  std::string type_;
  int version_;
  std::string icon_;
  document::ParamSchema params_;
  Validate validate_;
};

inline document::FeatureSchemaPtr aSchema(std::string type = "box",
                                          TestSchema::Validate validate = validateSize) {
  return std::make_shared<const TestSchema>(std::move(type), std::move(validate));
}

/**
 * The default build of the test type: one cube of edge `size` at the origin named
 * bodyId(feature.id), created by the feature, without names (buildCube).
 */
BuildResult buildCube(const BuildInput& input, BuildContext& ctx);

/** A cube builder of `type` (CubeBuilder of the plan). */
class CubeBuilder final : public FeatureBuilder {
 public:
  explicit CubeBuilder(std::string type = "box") : type_(std::move(type)) {}
  [[nodiscard]] const std::string& type() const override { return type_; }
  BuildResult build(const BuildInput& input, BuildContext& ctx) const override {
    return buildCube(input, ctx);
  }

 private:
  std::string type_;
};

/** A builder that records every call before delegating to `build` (aSpyBuilder). */
class SpyBuilder final : public FeatureBuilder {
 public:
  using Build = std::function<BuildResult(const BuildInput&, BuildContext&)>;
  explicit SpyBuilder(std::string type = "box", Build build = buildCube)
      : type_(std::move(type)), build_(std::move(build)) {}

  [[nodiscard]] const std::string& type() const override { return type_; }
  BuildResult build(const BuildInput& input, BuildContext& ctx) const override;

  /** Ids of the built features, in call order. */
  [[nodiscard]] std::vector<std::string> builtIds() const { return builtIds_; }
  /** Input states of the calls, in call order. */
  [[nodiscard]] const std::vector<StatePtr>& inputStates() const { return inputStates_; }
  [[nodiscard]] int callCount() const { return static_cast<int>(builtIds_.size()); }
  void setBuild(Build build) { build_ = std::move(build); }
  void reset() {
    builtIds_.clear();
    inputStates_.clear();
  }

 private:
  std::string type_;
  Build build_;
  // A spy records calls through a const interface: the records are test bookkeeping.
  mutable std::vector<std::string> builtIds_;
  mutable std::vector<StatePtr> inputStates_;
};

// =============================================================================================
// Features, studios, regenerators

/** A feature of the test type: params { size } (aFeature of document). */
FeaturePtr aFeature(const std::string& id, double size = 1, const std::string& type = "box");
/** Features 'f1'..'fn' of the test type, each a new pointer. */
std::vector<FeaturePtr> features(int n);
/** A copy of the feature with a new size (new identity, same id). */
FeaturePtr resized(const FeaturePtr& feature, double size);
/** A copy of the feature with `suppressed` set. */
FeaturePtr suppressedCopy(const FeaturePtr& feature, bool suppressed = true);
/** A part studio of the features; by default everything is in front of the rollback bar. */
document::PartStudioData aStudio(std::vector<FeaturePtr> features, int rollbackIndex = -1);

/** A fake clock that never moves: durationMs is 0. */
inline double stoppedClock() { return 0; }

/**
 * A Regenerator over a CountingKernel with the test type 'box' (aSchema + SpyBuilder). The members
 * are declared in dependency order, so the Regenerator is destroyed before the kernel.
 */
struct RegenSetup {
  explicit RegenSetup(SpyBuilder::Build build = buildCube, Regenerator::Clock now = stoppedClock);

  CountingKernel kernel;
  document::FeatureSchemaRegistry schemas;
  FeatureBuilderRegistry builders;
  std::shared_ptr<SpyBuilder> box;
  std::unique_ptr<Regenerator> regenerator;
};

// =============================================================================================
// Sketch artifacts, build contexts, name tables

/**
 * The sketch artifact of `owner` (by default on the origin plane XY) with the `faces` as regions
 * 'r1', 'r2', …; the outline of region 'ri' is a unit circle with the id 'ri' at the origin.
 */
SketchArtifactPtr aSketchArtifact(const std::string& owner,
                                  const std::vector<ShapeHandle>& faces = {},
                                  std::optional<core::Plane> plane = std::nullopt,
                                  std::vector<SketchLineSegment> lines = {},
                                  Json entities = Json::array());

/** A build context with its own owned set (aBuildContext); not movable, hence by pointer. */
struct TestBuildContext {
  TestBuildContext(kernel::ModelingKernel& kernel, StatePtr state)
      : ctx(kernel, owned, std::move(state)) {}
  OwnedHandles owned;
  BuildContext ctx;
};

std::unique_ptr<TestBuildContext> aBuildContext(kernel::ModelingKernel& kernel,
                                                StatePtr state = RegenState::empty());

/** BuildInput of the feature over a state with its params unevaluated (aBuildInput). */
struct TestBuildInput {
  FeaturePtr feature;
  StatePtr state;
  [[nodiscard]] BuildInput input() const { return BuildInput{*feature, *feature->params, state}; }
};

/**
 * A name table from hand-written names: face and edge name → indices. The default topology has
 * just enough faces and edges for every index, none planar (surface Other, edges without faces).
 */
NameTablePtr aNameTable(const std::map<std::string, std::vector<int>>& faces = {},
                        const std::map<std::string, std::vector<int>>& edges = {},
                        std::optional<kernel::TopologySummary> topology = std::nullopt);

/** A state of exactly these artifacts. */
StatePtr aState(const std::vector<ArtifactPtr>& artifacts);

/** A body of `origin` over a shape with the name table (empty by default). */
BodyPtr aBody(const std::string& origin, ShapeHandle shape,
              NameTablePtr names = NameTable::empty());

/** The status kinds of a result by feature id, in feature order. */
std::vector<std::pair<std::string, FeatureStatusKind>> kindsOf(const RegenResult& result);

/** The status of a feature that must exist. */
const FeatureStatus& statusOf(const RegenResult& result, const std::string& id);

}  // namespace tinycad::regen::test
