#pragma once

// A parsed, immutable sketch and everything derived from it (spec 12 "Kontrola dat", "Křivky pro
// oblasti a odvozená id", "Zrcadlení a pole (M36)", "Text ve skice (M37)"; src/sketch/parse.ts,
// geometry.ts, patterns.ts, text.ts). One class instead of free functions over SketchData
// (decision N6): the parsed entities, the lookup by id and the derived curves belong together.
// Derived ids are byte-for-byte those of TS (shared cases sketch.derived).

#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/sketch/model.hpp"

namespace tinycad::sketch {

using Json = core::Json;

struct SketchIssue {
  enum class Path { Entities, Constraints };
  /** JSON path "entities" | "constraints"; code "sketch.invalidEntity" | "sketch.invalidConstraint". */
  Path path = Path::Entities;
  /** Index of the item; -1 when the list itself is not an array. */
  int index = -1;

  friend bool operator==(const SketchIssue&, const SketchIssue&) = default;
};

class Sketch {
 public:
  /**
   * The only trusted way from raw params to a Sketch (parseSketchData): checks shape and
   * invariants (references to existing entities of the right kind, unique ids, arc radii within
   * 1e-6 relative, valid pattern and text params, …) and reports EVERY problem in TS order
   * (entities by index, then constraints).
   */
  static core::Result<Sketch, std::vector<SketchIssue>> parse(const Json& entities,
                                                              const Json& constraints);

  /** From already valid parts (the solver output). Not checked again. */
  Sketch(std::vector<EntityPtr> entities, std::vector<ConstraintPtr> constraints);

  [[nodiscard]] const std::vector<EntityPtr>& entities() const { return entities_; }
  [[nodiscard]] const std::vector<ConstraintPtr>& constraints() const { return constraints_; }
  /** nullptr when there is no entity with the id. */
  [[nodiscard]] const SketchEntity* findEntity(const SketchEntityId& id) const;
  /** nullptr when there is no point with the id. */
  [[nodiscard]] const SketchPoint* findPoint(const SketchEntityId& id) const;

  /**
   * Copies of all patterns as plain point and curve entities with ids '<pattern>:<index>.<source>'
   * (patternCopies). Order: patterns in entity order, instances ascending, sources in `sources`
   * order, points before their curve, every id once; the original (index 0) is not copied.
   */
  [[nodiscard]] std::vector<EntityPtr> patternCopies() const;

  /**
   * The curves of all texts (construction ones too) in their real position, ids
   * '<text>:<char>-<code>.<loop>.<segment>' (textCurves). A zero-length baseline gives none.
   */
  [[nodiscard]] std::vector<Curve2> textCurves() const;

  /**
   * The curves that bound regions (regionCurves): non-construction curves in entity order, then
   * non-construction curve copies of patterns, then letter curves of non-construction texts.
   */
  [[nodiscard]] std::vector<Curve2> regionCurves() const;

  /**
   * One curve entity of this sketch with its point coordinates and id (curve2): an arc ccw, an
   * xline a line XLINE_EXTENT each way from the middle of p1p2, a spline a B-spline curve.
   */
  [[nodiscard]] Curve2 curve2(const SketchEntity& curve) const;

  /** The params JSON of the TS shape (optional fields only when set, numbers via numberJson). */
  [[nodiscard]] Json entitiesJson() const;
  [[nodiscard]] Json constraintsJson() const;

 private:
  std::vector<EntityPtr> entities_;
  std::vector<ConstraintPtr> constraints_;
  std::unordered_map<SketchEntityId, EntityPtr> byId_;
};

/** JSON of one entity / constraint in the TS shape. */
Json entityJson(const SketchEntity& entity);
Json constraintJson(const SketchConstraint& constraint);

/** The pattern of a copy id '<pattern>:<i>[-<j>].<source>', else nullopt (patternOfCopy). */
std::optional<SketchEntityId> patternOfCopy(std::string_view id);
/** The text of a letter curve id or the pattern of a copy id, else nullopt (derivedOwner). */
std::optional<SketchEntityId> derivedOwner(std::string_view id);

}  // namespace tinycad::sketch
