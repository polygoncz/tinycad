#pragma once

// The planegcs primitives of a sketch (port of toPrimitives and its helpers in
// src/solver-planegcs/solve.ts): the SketchPrimitive objects the TS adapter hands to the wrapper
// GcsWrapper of @salusoft89/planegcs, here as one plain struct with a type (decision N9).

#include <map>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "tinycad/sketch/solver.hpp"

namespace tinycad::solver_planegcs {

/** The planegcs `type` of a primitive: the geometries, then the constraints the adapter uses. */
enum class PrimitiveType {
  Point,
  Line,
  Circle,
  Arc,
  BSpline,
  // Constraints, named after the planegcs constraint types (constraint_param_index of 1.3.0).
  P2PCoincident,
  HorizontalL,
  VerticalL,
  HorizontalPP,
  VerticalPP,
  Parallel,
  PerpendicularLL,
  EqualLength,
  EqualRadiusCC,
  EqualRadiusAA,
  EqualRadiusCA,
  PointOnLinePL,
  PointOnCircle,
  PointOnArc,
  PointOnBSpline,
  TangentLC,
  TangentLA,
  TangentCC,
  TangentAA,
  TangentCA,
  AngleViaPoint,
  P2PSymmetricPPP,
  P2PSymmetricPPL,
  CoordinateX,
  CoordinateY,
  P2PDistance,
  P2LDistance,
  L2LAnglePPPP,
  Difference,
  CircleRadius,
  ArcRadius,
  CircleDiameter,
  ArcDiameter,
  ArcRules,
};

/**
 * A number argument of a constraint (`object_param_or_number` of the wrapper): a number (a new
 * fixed p-param), a sketch param by name, or a property of a geometry ({ o_id, prop }).
 */
struct ParamValue {
  enum class Kind { Number, SketchParam, Property };
  Kind kind = Kind::Number;
  double number = 0;
  /** SketchParam: its name; Property: the id of the geometry. */
  std::string name;
  /** Property: "x", "y" or "radius". */
  std::string property;

  static ParamValue of(double value) { return {Kind::Number, value, {}, {}}; }
  static ParamValue param(std::string name) { return {Kind::SketchParam, 0, std::move(name), {}}; }
  static ParamValue propertyOf(std::string id, std::string prop) {
    return {Kind::Property, 0, std::move(id), std::move(prop)};
  }
};

struct Primitive {
  PrimitiveType type = PrimitiveType::Point;
  std::string id;
  /** Point. */
  double x = 0, y = 0;
  bool fixed = false;
  /** Circle (radius) and Arc. */
  double radius = 0, startAngle = 0, endAngle = 0;
  /** BSpline: weights, distinct knots with multiplicities, degree (never periodic). */
  std::vector<double> weights, knots;
  std::vector<int> mult;
  int degree = 0;
  /**
   * The ids of other primitives in the order of the planegcs fields: a line p1, p2; a circle its
   * centre; an arc centre, start, end; a bspline its poles; a constraint its `object_id` params.
   */
  std::vector<std::string> refs;
  /** The number params of a constraint in field order. */
  std::vector<ParamValue> values;
  /** A temporary constraint (the drag): tag -1, yields to the others. */
  bool temporary = false;

  [[nodiscard]] bool isGeometry() const {
    return type == PrimitiveType::Point || type == PrimitiveType::Line ||
           type == PrimitiveType::Circle || type == PrimitiveType::Arc ||
           type == PrimitiveType::BSpline;
  }
};

/** The free curve parameter of a point on a spline: a planegcs sketch param. */
struct FreeParam {
  std::string name;
  /** The start value. */
  double value = 0;
  sketch::SketchConstraintId constraint;
};

/** pointOnCurve on a spline → the end its parameter is fixed at (second solve only). */
using Ends = std::map<sketch::SketchConstraintId, int>;

struct Primitives {
  /** nullopt: the input cannot be solved (the dragged point does not exist). */
  std::optional<std::vector<Primitive>> primitives;
  /** Free parameters the primitives refer to by name. */
  std::vector<FreeParam> params;
  /** planegcs id → id of the sketch constraint it comes from; internal constraints are absent. */
  std::unordered_map<std::string, sketch::SketchConstraintId> constraintIds;
};

/** Prefix of the temporary drag constraints; never reported back. */
inline constexpr const char* DRAG = "__drag";

/** The primitives of a solve; throws std::runtime_error for data planegcs cannot take. */
Primitives toPrimitives(const sketch::Sketch& sketch, const std::optional<sketch::Drag>& drag,
                        const Ends& ends);

/** The hidden control point `i` of a fitSpline in planegcs. */
std::string poleId(const sketch::SketchEntityId& spline, std::size_t i);

/** The degrees of freedom planegcs counts but the sketch does not have (Q087). */
int unusedSplineParams(const std::vector<Primitive>& primitives);

}  // namespace tinycad::solver_planegcs
