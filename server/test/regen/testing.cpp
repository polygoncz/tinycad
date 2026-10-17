#include "regen/testing.hpp"

#include <algorithm>
#include <numbers>

#include "tinycad/document/origin.hpp"
#include "tinycad/document/refs.hpp"

namespace tinycad::regen::test {

// =============================================================================================
// CountingKernel

int CountingKernel::calls(const std::string& method) const {
  const auto it = counts_.find(method);
  return it == counts_.end() ? 0 : it->second;
}

int CountingKernel::modelingCalls() const {
  int total = 0;
  for (const auto& [method, count] : counts_) {
    if (method != "release") total += count;
  }
  return total;
}

void CountingKernel::failNext(const std::string& method, kernel::KernelError error) {
  failures_[method] = std::move(error);
}

std::optional<kernel::KernelError> CountingKernel::enter(const std::string& method) {
  ++counts_[method];
  const auto it = failures_.find(method);
  if (it == failures_.end()) return std::nullopt;
  kernel::KernelError error = it->second;
  failures_.erase(it);
  return error;
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::makeBox(const kernel::BoxInput& p) {
  if (auto e = enter("makeBox")) return core::fail(*e);
  return occt_.makeBox(p);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::makeCylinder(
    const kernel::CylinderInput& p) {
  if (auto e = enter("makeCylinder")) return core::fail(*e);
  return occt_.makeCylinder(p);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::transform(ShapeHandle shape,
                                                                    const core::Mat4& m) {
  if (auto e = enter("transform")) return core::fail(*e);
  return occt_.transform(shape, m);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::boolean(
    kernel::BooleanOp op, std::span<const ShapeHandle> targets,
    std::span<const ShapeHandle> tools) {
  booleanCalls_.push_back(BooleanCall{op, {targets.begin(), targets.end()}, {tools.begin(), tools.end()}});
  if (auto e = enter("boolean")) return core::fail(*e);
  return occt_.boolean(op, targets, tools);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::makeFace(const kernel::FaceInput& p) {
  if (auto e = enter("makeFace")) return core::fail(*e);
  return occt_.makeFace(p);
}

kernel::KernelResult<kernel::ProfileRegions> CountingKernel::profileRegions(
    std::span<const kernel::ProfileCurve> curves) {
  if (auto e = enter("profileRegions")) return core::fail(*e);
  return occt_.profileRegions(curves);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::extrude(ShapeHandle profile,
                                                                  const core::Vec3& direction,
                                                                  double distance) {
  if (auto e = enter("extrude")) return core::fail(*e);
  return occt_.extrude(profile, direction, distance);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::revolve(ShapeHandle profile,
                                                                  const kernel::Axis& axis,
                                                                  double angle) {
  if (auto e = enter("revolve")) return core::fail(*e);
  return occt_.revolve(profile, axis, angle);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::fillet(ShapeHandle shape,
                                                                 std::span<const int> edges,
                                                                 double radius) {
  if (auto e = enter("fillet")) return core::fail(*e);
  return occt_.fillet(shape, edges, radius);
}

kernel::KernelResult<kernel::ShapeResult> CountingKernel::chamfer(ShapeHandle shape,
                                                                  std::span<const int> edges,
                                                                  double distance) {
  if (auto e = enter("chamfer")) return core::fail(*e);
  return occt_.chamfer(shape, edges, distance);
}

kernel::KernelResult<kernel::BoundingBox> CountingKernel::boundingBox(ShapeHandle shape) {
  if (auto e = enter("boundingBox")) return core::fail(*e);
  return occt_.boundingBox(shape);
}

kernel::KernelResult<kernel::TopologySummary> CountingKernel::topology(ShapeHandle shape) {
  if (auto e = enter("topology")) return core::fail(*e);
  return occt_.topology(shape);
}

kernel::KernelResult<std::string> CountingKernel::exportStep(std::span<const ShapeHandle> shapes) {
  if (auto e = enter("exportStep")) return core::fail(*e);
  return occt_.exportStep(shapes);
}

kernel::KernelResult<kernel::MeshData> CountingKernel::tessellate(ShapeHandle shape,
                                                                  const kernel::MeshQuality& q) {
  if (auto e = enter("tessellate")) return core::fail(*e);
  return occt_.tessellate(shape, q);
}

kernel::KernelResult<void> CountingKernel::release(std::span<const ShapeHandle> handles) {
  if (auto e = enter("release")) return core::fail(*e);
  return occt_.release(handles);
}

std::size_t CountingKernel::liveHandleCount() const { return occt_.liveHandleCount(); }

// =============================================================================================
// The test feature type

std::vector<document::ParamIssue> validateSize(const Json& params) {
  if (params.is_object() && params.contains("size") && params["size"].is_number() &&
      params["size"].get<double>() > 0) {
    return {};
  }
  return {document::ParamIssue{"size", "param.atOrBelowMin", Json{{"min", 0}}}};
}

TestSchema::TestSchema(std::string type, Validate validate, int version)
    : type_(std::move(type)), version_(version), validate_(std::move(validate)) {
  document::ParamSpec size;
  size.kind = document::ParamKind::Length;
  size.label = "Size";
  size.defaultValue = 1;
  size.min = 0.0;
  size.exclusiveMin = true;
  params_.push_back(document::ParamEntry{"size", size});
}

BuildResult buildCube(const BuildInput& input, BuildContext& ctx) {
  const double size = input.params.at("size").get<double>();
  auto result = ctx.kernel().makeBox(kernel::BoxInput{{0, 0, 0}, {size, size, size}});
  if (!result) return core::fail(kernelFailure(result.error()));
  const auto& id = input.feature.id;
  return BuildOutput{input.state->with(std::make_shared<const Body>(
                         document::bodyId(id), id, id, result->shape, NameTable::empty())),
                     {}};
}

BuildResult SpyBuilder::build(const BuildInput& input, BuildContext& ctx) const {
  builtIds_.push_back(input.feature.id.str());
  inputStates_.push_back(input.state);
  return build_(input, ctx);
}

// =============================================================================================
// Features, studios, regenerators

FeaturePtr aFeature(const std::string& id, double size, const std::string& type) {
  auto f = std::make_shared<document::FeatureInstance>();
  f->id = FeatureId(id);
  f->type = type;
  f->typeVersion = 1;
  f->name = id;
  f->params = std::make_shared<const Json>(Json{{"size", size}});
  return f;
}

std::vector<FeaturePtr> features(int n) {
  std::vector<FeaturePtr> out;
  for (int i = 1; i <= n; ++i) out.push_back(aFeature("f" + std::to_string(i)));
  return out;
}

FeaturePtr resized(const FeaturePtr& feature, double size) {
  auto f = std::make_shared<document::FeatureInstance>(*feature);
  f->params = std::make_shared<const Json>(Json{{"size", size}});
  return f;
}

FeaturePtr suppressedCopy(const FeaturePtr& feature, bool suppressed) {
  auto f = std::make_shared<document::FeatureInstance>(*feature);
  f->suppressed = suppressed;
  return f;
}

document::PartStudioData aStudio(std::vector<FeaturePtr> features, int rollbackIndex) {
  document::PartStudioData studio;
  studio.rollbackIndex = rollbackIndex < 0 ? static_cast<int>(features.size()) : rollbackIndex;
  studio.features = std::move(features);
  return studio;
}

RegenSetup::RegenSetup(SpyBuilder::Build build, Regenerator::Clock now)
    : box(std::make_shared<SpyBuilder>("box", std::move(build))) {
  schemas.add(aSchema());
  builders.add(box);
  regenerator = std::make_unique<Regenerator>(kernel, builders, schemas, std::move(now));
}

// =============================================================================================
// Sketch artifacts, build contexts, name tables

SketchArtifactPtr aSketchArtifact(const std::string& owner, const std::vector<ShapeHandle>& faces,
                                  std::optional<core::Plane> plane,
                                  std::vector<SketchLineSegment> lines, Json entities) {
  auto sketch = std::make_shared<SketchArtifact>(FeatureId(owner));
  sketch->plane = plane.value_or(document::ORIGIN_PLANES[0].plane);
  sketch->entities = std::make_shared<const Json>(std::move(entities));
  sketch->lines = std::move(lines);
  for (std::size_t i = 0; i < faces.size(); ++i) {
    const std::string name = "r" + std::to_string(i + 1);
    sketch->regions.push_back(SketchRegionFace{name, faces[i]});
    kernel::ProfileRegion region;
    region.name = name;
    region.outer = {core::Curve2::circle({0, 0}, 1, name)};
    region.area = std::numbers::pi;
    sketch->outlines.push_back(std::move(region));
  }
  return sketch;
}

std::unique_ptr<TestBuildContext> aBuildContext(kernel::ModelingKernel& kernel, StatePtr state) {
  return std::make_unique<TestBuildContext>(kernel, std::move(state));
}

NameTablePtr aNameTable(const std::map<std::string, std::vector<int>>& faces,
                        const std::map<std::string, std::vector<int>>& edges,
                        std::optional<kernel::TopologySummary> topology) {
  const auto countOf = [](const std::map<std::string, std::vector<int>>& byName) {
    int count = 0;
    for (const auto& [name, indices] : byName) {
      for (int i : indices) count = std::max(count, i + 1);
    }
    return count;
  };
  if (!topology) {
    kernel::TopologySummary t;
    t.faces.resize(static_cast<std::size_t>(countOf(faces)));
    t.edges.resize(static_cast<std::size_t>(countOf(edges)));
    topology = std::move(t);
  }
  std::vector<std::vector<TopoName>> faceNames(topology->faces.size());
  std::vector<std::optional<TopoName>> edgeNames(topology->edges.size());
  for (const auto& [name, indices] : faces) {
    for (int i : indices) faceNames.at(static_cast<std::size_t>(i)).emplace_back(name);
  }
  for (const auto& [name, indices] : edges) {
    for (int i : indices) {
      // An edge carries one name: the first by sort order, like nameOfEdge of the TS helper.
      auto& slot = edgeNames.at(static_cast<std::size_t>(i));
      if (!slot) slot = TopoName(name);
    }
  }
  return std::make_shared<const NameTable>(std::move(faceNames), std::move(edgeNames),
                                           std::move(*topology));
}

StatePtr aState(const std::vector<ArtifactPtr>& artifacts) {
  return std::make_shared<const RegenState>(artifacts);
}

BodyPtr aBody(const std::string& origin, ShapeHandle shape, NameTablePtr names) {
  const FeatureId id(origin);
  return std::make_shared<const Body>(document::bodyId(id), id, id, shape, std::move(names));
}

std::vector<std::pair<std::string, FeatureStatusKind>> kindsOf(const RegenResult& result) {
  std::vector<std::pair<std::string, FeatureStatusKind>> out;
  for (const auto& [id, status] : result.statuses) out.emplace_back(id.str(), status.kind);
  return out;
}

const FeatureStatus& statusOf(const RegenResult& result, const std::string& id) {
  const FeatureStatus* status = result.statusOf(FeatureId(id));
  if (status == nullptr) throw std::runtime_error("no status of " + id);
  return *status;
}

}  // namespace tinycad::regen::test
