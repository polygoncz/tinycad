#pragma once

// Test helpers of the sketch tests (the C++ side of the parts of src/sketch/testing.ts the tests
// need): JSON from a string literal, a point, issues of a parse and a parsed sketch.

#include <gtest/gtest.h>

#include <ostream>
#include <string>
#include <vector>

#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch {

/** GoogleTest output of an issue (found by ADL). */
inline void PrintTo(const SketchIssue& issue, std::ostream* os) {
  *os << (issue.path == SketchIssue::Path::Entities ? "entities" : "constraints") << "["
      << issue.index << "]";
}

}  // namespace tinycad::sketch

namespace tinycad::sketch::testing {

/** JSON from a literal: J(R"({"kind": "point"})"). */
inline Json J(const char* text) { return Json::parse(text); }

/** A point entity. */
inline Json P(const std::string& id, double x = 0, double y = 0) {
  return {{"kind", "point"}, {"id", id}, {"x", core::numberJson(x)}, {"y", core::numberJson(y)}};
}

/** The array `base` with `more` appended. */
inline Json appended(Json base, const Json& more) {
  for (const auto& item : more) base.push_back(item);
  return base;
}

/** The object with `patch` merged in (like { ...item, ...patch } in TS). */
inline Json with(Json item, const Json& patch) {
  for (const auto& [key, value] : patch.items()) item[key] = value;
  return item;
}

/** The object without the key. */
inline Json without(Json item, const std::string& key) {
  item.erase(key);
  return item;
}

inline SketchIssue entityIssue(int index) { return {SketchIssue::Path::Entities, index}; }
inline SketchIssue constraintIssue(int index) { return {SketchIssue::Path::Constraints, index}; }

/** The issues of a parse; empty when it passes. */
inline std::vector<SketchIssue> issuesOf(const Json& entities, const Json& constraints) {
  const auto parsed = Sketch::parse(entities, constraints);
  return parsed ? std::vector<SketchIssue>{} : parsed.error();
}

/** A sketch from valid data; fails the test for invalid data. */
inline Sketch sketchOf(const Json& entities, const Json& constraints = Json::array()) {
  auto parsed = Sketch::parse(entities, constraints);
  if (!parsed) {
    ADD_FAILURE() << "invalid test sketch: " << entities.dump();
    return Sketch({}, {});
  }
  return std::move(*parsed);
}

/**
 * The contours of the fake outliner of src/sketch/testing.ts for an ASCII text: every
 * non-space character i is one square loop of side 0.5·height from x = (0.6·i + 0.05)·height.
 */
inline Json fakeContours(const std::string& text, double height) {
  Json contours = Json::array();
  for (std::size_t i = 0; i < text.size(); ++i) {
    if (text[i] == ' ') continue;
    const double x0 = (static_cast<double>(i) * 0.6 + (0.6 - 0.5) / 2) * height;
    const double x1 = x0 + 0.5 * height;
    const double y1 = 0.5 * height;
    const std::vector<Vec2> c = {{x0, 0}, {x1, 0}, {x1, y1}, {x0, y1}};
    Json segments = Json::array();
    for (std::size_t k = 0; k < 4; ++k) {
      const Vec2& p = c[k];
      const Vec2& q = c[(k + 1) % 4];
      segments.push_back(Json::array({Json::array({p[0], p[1]}), Json::array({q[0], q[1]})}));
    }
    contours.push_back({{"char", i}, {"code", static_cast<int>(text[i])}, {"segments", segments}});
  }
  return contours;
}

struct TextOptions {
  std::string id = "t";
  std::string text = "ab";
  double height = 10;
  Vec2 p1{0, 0};
  Vec2 p2{10, 0};
  /** null: the fake contours of text and height. */
  Json contours = nullptr;
  bool construction = false;
};

/**
 * A text on its baseline (textData of src/sketch/testing.ts): points `<id>.p1`, `<id>.p2`, the
 * construction line `<id>.bl` between them and the text `<id>`.
 */
inline Json textEntities(const TextOptions& o = {}) {
  Json text = {{"kind", "text"},          {"id", o.id},
               {"text", o.text},          {"font", "sans"},
               {"height", o.height},      {"baseline", o.id + ".bl"},
               {"contours", o.contours.is_null() ? fakeContours(o.text, o.height) : o.contours}};
  if (o.construction) text["construction"] = true;
  return Json::array({P(o.id + ".p1", o.p1[0], o.p1[1]), P(o.id + ".p2", o.p2[0], o.p2[1]),
                      {{"kind", "line"},
                       {"id", o.id + ".bl"},
                       {"p1", o.id + ".p1"},
                       {"p2", o.id + ".p2"},
                       {"construction", true}},
                      text});
}

}  // namespace tinycad::sketch::testing
