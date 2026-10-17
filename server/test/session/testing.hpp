#pragma once

// Test helpers of the session layer (M45): a part studio from JSON (fromData over the built-in
// schemas), a Regenerator over the real OcctKernel with the built-in builders (decision N45) and
// the read model of one regeneration (domain data, read_model.hpp). Test-only.
//
// The sketch builder of M44.1 is not among the built-in builders yet, so the read model tests of
// sketches use a small test type 'testSketch' (schema without rules, builder that turns its params
// into a SketchArtifact as they are: entities, derivedEntities, outlines, plane XY).

#include <gtest/gtest.h>

#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "regen/testing.hpp"
#include "tinycad/core/json.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/regen/regenerator.hpp"
#include "tinycad/session/read_model_builder.hpp"

namespace tinycad::session::test {

using core::Json;

/** Feature JSON of the document format (spec 03). */
inline Json aFeatureJson(const std::string& id, const std::string& type, Json params,
                         int typeVersion = 1) {
  return Json{{"id", id},          {"type", type},     {"typeVersion", typeVersion},
              {"name", id},        {"params", std::move(params)}, {"suppressed", false}};
}

inline Json boxJson(const std::string& id, core::Vec3 origin, double size = 10,
                    double height = 10) {
  return aFeatureJson(id, "box",
                      Json{{"origin", {origin[0], origin[1], origin[2]}},
                           {"width", size},
                           {"depth", size},
                           {"height", height}});
}

inline Json cylinderJson(const std::string& id, double radius = 5, double height = 10) {
  return aFeatureJson(id, "cylinder",
                      Json{{"base", {0, 0, 0}}, {"axis", "z"}, {"radius", radius}, {"height", height}});
}

/** The schema of 'testSketch': no params, no rules, any params pass. */
class TestSketchSchema final : public document::FeatureSchema {
 public:
  [[nodiscard]] const std::string& type() const override { return type_; }
  [[nodiscard]] int version() const override { return 1; }
  [[nodiscard]] const std::string& label() const override { return type_; }
  [[nodiscard]] const std::string& icon() const override { return type_; }
  [[nodiscard]] const document::ParamSchema& params() const override { return params_; }
  [[nodiscard]] Json defaults() const override { return Json::object(); }
  [[nodiscard]] std::vector<document::ParamIssue> validate(const Json& /*params*/) const override {
    return {};
  }
  [[nodiscard]] bool hasMigrate() const override { return false; }

 private:
  std::string type_ = "testSketch";
  document::ParamSchema params_;
};

/**
 * The builder of 'testSketch': a SketchArtifact on the plane XY with params.entities,
 * params.derived and one region "c1,l1,l2,l3,l4" (a 10×10 square l1..l4 with a hole circle c1 of
 * radius 2 at its middle); anchor 'base' at the origin with direction +z.
 */
class TestSketchBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override { return type_; }
  regen::BuildResult build(const regen::BuildInput& input,
                           regen::BuildContext& /*ctx*/) const override {
    auto sketch = std::make_shared<regen::SketchArtifact>(input.feature.id);
    sketch->plane = core::Plane{{0, 0, 0}, {1, 0, 0}, {0, 0, 1}};
    sketch->entities = std::make_shared<const Json>(input.params.value("entities", Json::array()));
    sketch->derivedEntities =
        std::make_shared<const Json>(input.params.value("derived", Json::array()));
    kernel::ProfileRegion region;
    region.name = "c1,l1,l2,l3,l4";
    region.outer = {core::Curve2::line({0, 0}, {10, 0}, "l1"),
                    core::Curve2::line({10, 0}, {10, 10}, "l2"),
                    core::Curve2::line({10, 10}, {0, 10}, "l3"),
                    core::Curve2::line({0, 10}, {0, 0}, "l4")};
    region.holes = {{core::Curve2::circle({5, 5}, 2, "c1")}};
    region.area = 100 - 4 * 3.141592653589793;
    sketch->outlines = {region};
    regen::FeatureAnchors anchors;
    anchors["base"] = regen::Anchor{{0, 0, 0}, core::Vec3{0, 0, 1}};
    return regen::BuildOutput{input.state->with(std::move(sketch)), std::move(anchors)};
  }

 private:
  std::string type_ = "testSketch";
};

/** Document JSON (DocumentData of spec 03) with the features. */
inline Json aDocumentJson(Json features, int rollbackIndex = -1, Json bodies = Json::object()) {
  const int count = static_cast<int>(features.size());
  Json studio{{"features", std::move(features)},
              {"rollbackIndex", rollbackIndex < 0 ? count : rollbackIndex}};
  if (!bodies.empty()) studio["bodies"] = std::move(bodies);
  return Json{{"meta", {{"id", "doc-1"}, {"name", "Part 1"}, {"createdAt", 1700000000123}}},
              {"studio", std::move(studio)}};
}

/** The quality of the read model tests. */
inline kernel::MeshQuality testQuality() { return {0.1, 0.5}; }

/**
 * One runtime document of the tests without sessions: a CountingKernel over OcctKernel (counts
 * tessellate), the built-in schemas and builders plus 'testSketch', a Regenerator, the mesh cache
 * and the read model builder. Members in dependency order.
 */
class StudioFixture {
 public:
  StudioFixture() {
    features::registerBuiltInSchemas(schemas);
    schemas.add(std::make_shared<const TestSketchSchema>());
    features::registerBuiltInBuilders(builders);
    builders.add(std::make_shared<const TestSketchBuilder>());
    regenerator = std::make_unique<regen::Regenerator>(kernel, builders, schemas,
                                                       regen::test::stoppedClock);
  }

  /** A document from JSON; throws when the data do not load. */
  std::unique_ptr<document::Document> load(const Json& data) const {
    auto doc = document::fromData(data, schemas);
    if (!doc) throw std::runtime_error("test document does not load: " + data.dump());
    return std::move(*doc);
  }

  /**
   * Regenerates the document (with options.inputOf) and builds its read model; the mesh cache
   * keeps only the live versions afterwards, as the runtime document does.
   */
  ReadModel readModel(const document::DocumentReader& doc, const ReadModelOptions& options = {}) {
    regen::RunOptions run;
    run.inputOf = options.inputOf;
    lastResult = regenerator->run(*doc.studio(), run);
    const ReadModelInput input{doc,  7,    3,     lastResult, *regenerator, true, true, false,
                               "Box 1: height", testQuality()};
    auto built = builder.build(input, options);
    if (!built) throw std::runtime_error("read model failed: " + built.error().message);
    meshes.retain(ReadModelBuilder::liveVersions(lastResult, *regenerator));
    return std::move(*built);
  }

  regen::test::CountingKernel kernel;
  document::FeatureSchemaRegistry schemas;
  regen::FeatureBuilderRegistry builders;
  std::unique_ptr<regen::Regenerator> regenerator;
  MeshCache meshes{kernel};
  ReadModelBuilder builder{meshes};
  regen::RegenResult lastResult;
};

/** ReadModelOptions with the known meshes and inputOf ('' = none). */
inline ReadModelOptions optionsWith(const std::vector<std::string>& known,
                                    const std::string& inputOf = "") {
  ReadModelOptions options;
  options.knownMeshes.insert(known.begin(), known.end());
  if (!inputOf.empty()) options.inputOf = document::FeatureId(inputOf);
  return options;
}

/** The content version of every body, in order. */
inline std::vector<std::string> versionsOf(const std::vector<BodyView>& bodies) {
  std::vector<std::string> out;
  for (const auto& body : bodies) out.push_back(body.contentVersion);
  return out;
}

/** Ids of the bodies that carry a mesh, in order. */
inline std::vector<std::string> bodiesWithMesh(const std::vector<BodyView>& bodies) {
  std::vector<std::string> out;
  for (const auto& body : bodies) {
    if (body.mesh) out.push_back(body.body->id());
  }
  return out;
}

}  // namespace tinycad::session::test
