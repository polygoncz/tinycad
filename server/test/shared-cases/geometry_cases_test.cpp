// The runner of the shared cases geometry.* (spec 13, "Druhy případů"; the TypeScript twin is
// test/integration/shared-cases/geometry.test.ts): one test per file of
// test/shared-cases/geometry/, the input in the shape of the port SketchGeometry, the output
// compared with expected within the tolerances of spec 13; an error only by its code.

#include <gtest/gtest.h>

#include <stdexcept>
#include <string>

#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/core/json.hpp"
#include "tinycad/geometry/geometry.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using geometry::Curve2;

/** Runs the input of a case through Geometry2d by the kind of the case. */
class GeometryCaseRunner {
 public:
  /** { ok: output } of the call of the case's kind, or { error: { code } }. */
  [[nodiscard]] Json run(const std::string& kind, const Json& input) const;

 private:
  [[nodiscard]] Json intersections(const Json& input) const;
  [[nodiscard]] Json segment(const Json& input) const;
  [[nodiscard]] Json fillet(const Json& input) const;
  [[nodiscard]] Json offset(const Json& input) const;

  geometry::Geometry2d geometry_;
};

/** A curve of the case; a malformed one is a broken case, not a kernel error. */
Curve2 curveOf(const Json& value) {
  const auto curve = core::readCurve2(value);
  if (!curve) throw std::runtime_error("not a curve: " + value.dump());
  return *curve;
}

std::vector<Curve2> curvesOf(const Json& value) {
  std::vector<Curve2> curves;
  for (const auto& c : value) curves.push_back(curveOf(c));
  return curves;
}

Json pointJson(geometry::Vec2 v) { return Json::array({v[0], v[1]}); }

Json errorJson(const geometry::GeometryError& error) {
  return {{"error", {{"code", std::string(geometry::codeName(error.code))}}}};
}

Json GeometryCaseRunner::run(const std::string& kind, const Json& input) const {
  if (kind == "geometry.intersections") return intersections(input);
  if (kind == "geometry.segment") return segment(input);
  if (kind == "geometry.fillet") return fillet(input);
  if (kind == "geometry.offset") return offset(input);
  throw std::runtime_error("unknown kind " + kind);
}

Json GeometryCaseRunner::intersections(const Json& input) const {
  const auto hits = geometry_.intersections(curvesOf(input.at("curves")));
  if (!hits) return errorJson(hits.error());
  Json out = Json::array();
  for (const auto& hit : *hits) {
    Json h = {{"a", hit.a},   {"b", hit.b},   {"point", pointJson(hit.point)},
              {"ta", hit.ta}, {"tb", hit.tb}};
    if (hit.overlap) h["overlap"] = true;
    out.push_back(h);
  }
  return {{"ok", {{"hits", out}}}};
}

Json GeometryCaseRunner::segment(const Json& input) const {
  const auto piece = geometry_.segment(curveOf(input.at("curve")), input.at("from").get<double>(),
                                       input.at("to").get<double>());
  if (!piece) return errorJson(piece.error());
  return {{"ok", {{"curve", core::curve2Json(*piece)}}}};
}

Json GeometryCaseRunner::fillet(const Json& input) const {
  const auto arc = geometry_.fillet(curveOf(input.at("a")), curveOf(input.at("b")),
                                    input.at("radius").get<double>(),
                                    *core::readVec2(input.at("near")));
  if (!arc) return errorJson(arc.error());
  return {{"ok",
           {{"center", pointJson(arc->center)},
            {"pointA", pointJson(arc->pointA)},
            {"pointB", pointJson(arc->pointB)},
            {"ta", arc->ta},
            {"tb", arc->tb}}}};
}

Json GeometryCaseRunner::offset(const Json& input) const {
  const auto curves = geometry_.offset(curvesOf(input.at("chain")), input.at("closed").get<bool>(),
                                       input.at("distance").get<double>());
  if (!curves) return errorJson(curves.error());
  Json out = Json::array();
  for (const auto& c : *curves) {
    Json curve = core::curve2Json(c.curve);
    if (!c.source.empty()) curve["source"] = c.source;
    out.push_back(curve);
  }
  return {{"ok", {{"curves", out}}}};
}

class GeometrySharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(GeometrySharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("geometry", GetParam());
  const std::string kind = sharedCase.at("kind").get<std::string>();
  ASSERT_EQ(kind.rfind("geometry.", 0), 0U) << "a case of another area: " << kind;
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";

  const Json actual = GeometryCaseRunner().run(kind, sharedCase.at("input"));
  const Tolerance tolerance = resolveTolerance(sharedCase.value("tolerance", Json(nullptr)));
  const auto difference = firstDifference(sharedCase.at("expected"), actual, tolerance);
  EXPECT_FALSE(difference.has_value())
      << GetParam() << ".json: " << sharedCase.at("description").get<std::string>() << "\n"
      << difference.value_or("") << "\nactual: " << actual.dump();
}

std::string testName(const ::testing::TestParamInfo<std::string>& info) {
  std::string name = info.param;
  for (char& c : name) {
    if (c == '-') c = '_';
  }
  return name;
}

INSTANTIATE_TEST_SUITE_P(Geometry, GeometrySharedCase, ::testing::ValuesIn(caseNames("geometry")),
                         testName);

// No folder or no case would leave the suite empty and green.
TEST(GeometrySharedCases, AreFound) { EXPECT_FALSE(caseNames("geometry").empty()); }

}  // namespace
}  // namespace tinycad::testing
