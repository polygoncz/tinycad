#pragma once

// Internal helpers shared by the derived curves (geometry.cpp, patterns.cpp, text.cpp); the C++
// side of src/sketch/points.ts and of the parts of geometry.ts, text.ts and edit.ts they share.

#include <unordered_map>
#include <vector>

#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch::detail {

/** The points of a list of entities by id (pointsById). */
using PointMap = std::unordered_map<SketchEntityId, const SketchPoint*>;

PointMap pointsById(const std::vector<EntityPtr>& entities);

/** The curve with its point coordinates (curve2); a missing point is a programming error. */
Curve2 curveOf(const SketchEntity& curve, const PointMap& points);

/** The ids of the defining points of a curve (curvePoints of edit.ts). */
std::vector<SketchEntityId> curvePoints(const SketchEntity& curve);

/** The letter curves of the texts among the entities (textCurves over that entity list). */
std::vector<Curve2> textCurvesOf(const std::vector<EntityPtr>& entities);

}  // namespace tinycad::sketch::detail
