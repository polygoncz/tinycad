#pragma once

// The output edges of BRepOffsetAPI_MakeOffset as data and their assembly into one chain along
// the input (port of the second half of src/kernel-occt/offset.ts). Internal to
// tinycad_geometry.

#include <functional>
#include <string>
#include <vector>

#include "tinycad/geometry/geometry.hpp"
#include "failure.hpp"

namespace tinycad::geometry::detail {

/**
 * An output edge as data, oriented as its own curve (not yet along the chain). A piece that is
 * neither a line nor a circle (the offset of a spline) is Sampled: `sample(n)` evaluates n + 1
 * points from its `from` to its `to`. `source` is the id of the input curve, empty for a join.
 */
struct Piece {
  enum class Kind { Line, Arc, Circle, Sampled };
  Kind kind = Kind::Line;
  Vec2 from{};
  Vec2 to{};
  Vec2 center{};
  bool ccw = true;
  double radius = 0;
  std::function<std::vector<Vec2>(int)> sample;
  std::string source;
};

/** An 'operation-failed' of offsetCurves. */
Failure offsetFailure(const std::string& reason);

/**
 * The pieces (no circle among them) in one chain by their ends, each oriented along it: an open
 * chain from a piece with a free end. Pieces left over (several wires) fail.
 */
std::vector<Piece> chained(std::vector<Piece> pieces, bool closed, double tol);

/** The chain turned to run as the input does: a piece with a source runs along its curve. */
std::vector<Piece> alongInput(const std::vector<Piece>& chain, const std::vector<Curve2>& curves);

/** A closed chain started with the first piece of the earliest input curve. */
std::vector<Piece> fromFirst(const std::vector<Piece>& chain, const std::vector<Curve2>& curves);

/**
 * The curves of the chain: each piece joined exactly to the previous one, the sampled pieces of
 * one spline merged into one fitted cubic B-spline.
 */
std::vector<OffsetCurve> curvesOf(const std::vector<Piece>& chain, bool closed, double scale);

/** Whether the result lies to the right of the chain (the middle of its first sourced curve). */
bool onRight(const std::vector<OffsetCurve>& result, const std::vector<Curve2>& curves);

}  // namespace tinycad::geometry::detail
