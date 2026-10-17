#pragma once

// The data model of a sketch (spec 12 "Data", src/sketch/model.ts): entities and constraints as
// stored in the params of a sketch feature. Coordinates are already solved, so regeneration never
// needs the solver.
//
// Plain OOP (decisions N9, N23): a small class hierarchy per TS union. The base class carries
// `kind` and `id`; code switches on kind() and reads the concrete type with as<T>(). Objects are
// immutable after construction and shared as shared_ptr<const …>; a change (the solver moving a
// point) makes a new object. A JSON round trip keeps every field of the TS shape (sketch.hpp).
//
// The sketch library depends only on core: no OCCT, no document, no regen (M44 acceptance).

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/core/strong_id.hpp"

namespace tinycad::sketch {

using core::Vec2;
/** The curve with point coordinates and the entity id (curve2 in TS). */
using Curve2 = core::Curve2;

struct SketchEntityIdTag;
struct SketchConstraintIdTag;
using SketchEntityId = core::StrongId<SketchEntityIdTag>;
using SketchConstraintId = core::StrongId<SketchConstraintIdTag>;

/** The feature type of a sketch and the names of its params (spec 12 "Featura skici"). */
inline constexpr std::string_view SKETCH_FEATURE_TYPE = "sketch";
inline constexpr std::string_view SKETCH_PARAM_PLANE = "plane";
inline constexpr std::string_view SKETCH_PARAM_ENTITIES = "entities";
inline constexpr std::string_view SKETCH_PARAM_CONSTRAINTS = "constraints";

/** The largest number of instances in one direction of a pattern. */
inline constexpr int MAX_PATTERN_COUNT = 100;
/** The longest text in code points. */
inline constexpr int MAX_TEXT_LENGTH = 200;
/** |angle| of a circular pattern within this of 2π is a full circle. */
inline constexpr double FULL_CIRCLE_TOLERANCE = 1e-9;
/** Half the length (mm) of the line an xline becomes in curve2 (M31). */
inline constexpr double XLINE_EXTENT = 1e5;

// =============================================================================================
// Entities

/** JSON `kind`: point, line, circle, arc, bspline, fitSpline, xline, mirror, linearPattern,
 *  circularPattern, text. */
enum class EntityKind {
  Point,
  Line,
  Circle,
  Arc,
  BSpline,
  FitSpline,
  XLine,
  Mirror,
  LinearPattern,
  CircularPattern,
  Text,
};

std::string_view entityKindName(EntityKind kind);

class SketchEntity {
 public:
  virtual ~SketchEntity() = default;

  [[nodiscard]] EntityKind kind() const { return kind_; }
  [[nodiscard]] const SketchEntityId& id() const { return id_; }

  /** A curve: not a point, pattern or text (isCurveEntity). */
  [[nodiscard]] bool isCurve() const;
  /** Mirror, linear or circular pattern (isPattern). */
  [[nodiscard]] bool isPattern() const;
  /** A line or an xline (isLineCarrier). */
  [[nodiscard]] bool isLineCarrier() const;
  /** A point or a curve (isPatternSource). */
  [[nodiscard]] bool isPatternSource() const;

  /** The concrete type; the caller has checked kind(). Another type is a bug (AssertionError). */
  template <class T>
  [[nodiscard]] const T& as() const {
    const T* concrete = dynamic_cast<const T*>(this);
    TINYCAD_ASSERT(concrete != nullptr, "Sketch entity '" + id_.str() + "' is a " +
                                            std::string(entityKindName(kind_)) +
                                            ", not the type asked for");
    return *concrete;
  }

 protected:
  SketchEntity(EntityKind kind, SketchEntityId id) : kind_(kind), id_(std::move(id)) {}

 private:
  EntityKind kind_;
  SketchEntityId id_;
};

using EntityPtr = std::shared_ptr<const SketchEntity>;

struct SketchPoint final : SketchEntity {
  SketchPoint(SketchEntityId id, double x_, double y_)
      : SketchEntity(EntityKind::Point, std::move(id)), x(x_), y(y_) {}
  double x;
  double y;
};

/** `construction` = the TS optional `construction?: true` (false = absent in JSON). */
struct SketchLine final : SketchEntity {
  SketchLine(SketchEntityId id, SketchEntityId p1_, SketchEntityId p2_, bool construction_)
      : SketchEntity(EntityKind::Line, std::move(id)),
        p1(std::move(p1_)), p2(std::move(p2_)), construction(construction_) {}
  SketchEntityId p1, p2;
  bool construction;
};

struct SketchCircle final : SketchEntity {
  SketchCircle(SketchEntityId id, SketchEntityId center_, double radius_, bool construction_)
      : SketchEntity(EntityKind::Circle, std::move(id)),
        center(std::move(center_)), radius(radius_), construction(construction_) {}
  SketchEntityId center;
  double radius;
  bool construction;
};

/** Counter-clockwise from start to end around center. */
struct SketchArc final : SketchEntity {
  SketchArc(SketchEntityId id, SketchEntityId center_, SketchEntityId start_, SketchEntityId end_,
            bool construction_)
      : SketchEntity(EntityKind::Arc, std::move(id)),
        center(std::move(center_)), start(std::move(start_)), end(std::move(end_)),
        construction(construction_) {}
  SketchEntityId center, start, end;
  bool construction;
};

/** A spline through control points: degree = min(3, poles − 1), clamped knots from 0 to 1. */
struct SketchBSpline final : SketchEntity {
  SketchBSpline(SketchEntityId id, int degree_, std::vector<SketchEntityId> poles_,
                std::vector<double> knots_, bool construction_)
      : SketchEntity(EntityKind::BSpline, std::move(id)),
        degree(degree_), poles(std::move(poles_)), knots(std::move(knots_)),
        construction(construction_) {}
  int degree;
  /** Sketch points, ≥ 2, distinct. */
  std::vector<SketchEntityId> poles;
  std::vector<double> knots;
  bool construction;
};

/** A spline through points; its solved poles are stored (regen never calls the solver). */
struct SketchFitSpline final : SketchEntity {
  SketchFitSpline(SketchEntityId id, int degree_, std::vector<SketchEntityId> fit_,
                  std::vector<double> params_, std::vector<Vec2> poles_, std::vector<double> knots_,
                  bool construction_)
      : SketchEntity(EntityKind::FitSpline, std::move(id)),
        degree(degree_), fit(std::move(fit_)), params(std::move(params_)), poles(std::move(poles_)),
        knots(std::move(knots_)), construction(construction_) {}
  int degree;
  std::vector<SketchEntityId> fit;
  std::vector<double> params;
  std::vector<Vec2> poles;
  std::vector<double> knots;
  bool construction;
};

/** A construction line without ends through two points (M31); always construction (JSON `true`). */
struct SketchXLine final : SketchEntity {
  SketchXLine(SketchEntityId id, SketchEntityId p1_, SketchEntityId p2_)
      : SketchEntity(EntityKind::XLine, std::move(id)), p1(std::move(p1_)), p2(std::move(p2_)) {}
  SketchEntityId p1, p2;
};

/** Mirror of the sources across the axis (a line or an xline), M36. */
struct SketchMirror final : SketchEntity {
  SketchMirror(SketchEntityId id, std::vector<SketchEntityId> sources_, SketchEntityId axis_)
      : SketchEntity(EntityKind::Mirror, std::move(id)),
        sources(std::move(sources_)), axis(std::move(axis_)) {}
  std::vector<SketchEntityId> sources;
  SketchEntityId axis;
};

struct PatternDirection {
  /** Rad from the plane x axis. */
  double angle = 0;
  /** 2 … MAX_PATTERN_COUNT. */
  int count = 2;
  /** Mm, > 0. */
  double spacing = 0;
};

struct SketchLinearPattern final : SketchEntity {
  SketchLinearPattern(SketchEntityId id, std::vector<SketchEntityId> sources_,
                      PatternDirection direction1_, std::optional<PatternDirection> direction2_)
      : SketchEntity(EntityKind::LinearPattern, std::move(id)),
        sources(std::move(sources_)), direction1(direction1_), direction2(direction2_) {}
  std::vector<SketchEntityId> sources;
  PatternDirection direction1;
  std::optional<PatternDirection> direction2;
};

struct SketchCircularPattern final : SketchEntity {
  SketchCircularPattern(SketchEntityId id, std::vector<SketchEntityId> sources_,
                        SketchEntityId center_, int count_, double angle_)
      : SketchEntity(EntityKind::CircularPattern, std::move(id)),
        sources(std::move(sources_)), center(std::move(center_)), count(count_), angle(angle_) {}
  std::vector<SketchEntityId> sources;
  /** A sketch point. */
  SketchEntityId center;
  int count;
  /** Rad, 0 < |angle| ≤ 2π; positive = counter-clockwise. */
  double angle;

  /** The angle between neighbouring instances (circularStep). */
  [[nodiscard]] double step() const;
};

/** "sans", "serif", "mono" (TEXT_FONTS order). */
enum class TextFont { Sans, Serif, Mono };

struct TextContour {
  /** Index of the character in code points; JSON key `char`. */
  int charIndex = 0;
  /** Its code point. */
  int code = 0;
  /** Each segment: 2 poles = a line, 3 = a quadratic, 4 = a cubic Bézier (local mm). */
  std::vector<std::vector<Vec2>> segments;
};

/** A one-line text with stored letter outlines (M37); never enters the solver. */
struct SketchText final : SketchEntity {
  SketchText(SketchEntityId id, std::string text_, TextFont font_, double height_,
             SketchEntityId baseline_, std::vector<TextContour> contours_, bool construction_)
      : SketchEntity(EntityKind::Text, std::move(id)),
        text(std::move(text_)), font(font_), height(height_), baseline(std::move(baseline_)),
        contours(std::move(contours_)), construction(construction_) {}
  /** UTF-8; 1 … MAX_TEXT_LENGTH code points, no control characters. */
  std::string text;
  TextFont font;
  double height;
  /** A line or an xline. */
  SketchEntityId baseline;
  std::vector<TextContour> contours;
  bool construction;
};

// =============================================================================================
// Constraints. One kind per TS `kind`; kinds with the same fields share one class.

enum class ConstraintKind {
  Coincident,
  Horizontal,
  Vertical,
  Parallel,
  Perpendicular,
  Equal,
  Tangent,
  PointOnCurve,
  Midpoint,
  HAlign,
  VAlign,
  Symmetric,
  Fix,
  Distance,
  HDistance,
  VDistance,
  PointLineDistance,
  Angle,
  Radius,
  Diameter,
  Offset,
};

/** The TS `kind` string ("coincident", "horizontal", …, "offset"). */
std::string_view constraintKindName(ConstraintKind kind);

class SketchConstraint {
 public:
  virtual ~SketchConstraint() = default;

  [[nodiscard]] ConstraintKind kind() const { return kind_; }
  [[nodiscard]] const SketchConstraintId& id() const { return id_; }
  /** A dimension: a constraint with a value (isDimension). */
  [[nodiscard]] bool isDimension() const;

  /**
   * The concrete type; the caller has checked kind(). Another type is a bug (AssertionError). A
   * dynamic_cast, not the kind: kinds with the same fields share one class.
   */
  template <class T>
  [[nodiscard]] const T& as() const {
    const T* concrete = dynamic_cast<const T*>(this);
    TINYCAD_ASSERT(concrete != nullptr, "Sketch constraint '" + id_.str() + "' is a " +
                                            std::string(constraintKindName(kind_)) +
                                            ", not the type asked for");
    return *concrete;
  }

 protected:
  SketchConstraint(ConstraintKind kind, SketchConstraintId id) : kind_(kind), id_(std::move(id)) {}

 private:
  ConstraintKind kind_;
  SketchConstraintId id_;
};

using ConstraintPtr = std::shared_ptr<const SketchConstraint>;

/**
 * Two entities a and b: coincident (points), parallel/perpendicular (lines or xlines), equal,
 * tangent, hAlign/vAlign (points).
 */
struct PairConstraint final : SketchConstraint {
  PairConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId a_, SketchEntityId b_)
      : SketchConstraint(kind, std::move(id)), a(std::move(a_)), b(std::move(b_)) {}
  SketchEntityId a, b;
};

/** horizontal / vertical of a line or an xline. */
struct LineConstraint final : SketchConstraint {
  LineConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId line_)
      : SketchConstraint(kind, std::move(id)), line(std::move(line_)) {}
  SketchEntityId line;
};

/** A point on the carrier of a line/xline, the circle of an arc or a spline within its ends. */
struct PointOnCurveConstraint final : SketchConstraint {
  PointOnCurveConstraint(SketchConstraintId id, SketchEntityId point_, SketchEntityId curve_)
      : SketchConstraint(ConstraintKind::PointOnCurve, std::move(id)),
        point(std::move(point_)), curve(std::move(curve_)) {}
  SketchEntityId point, curve;
};

/** A point in the middle of a line (not an xline). */
struct MidpointConstraint final : SketchConstraint {
  MidpointConstraint(SketchConstraintId id, SketchEntityId point_, SketchEntityId line_)
      : SketchConstraint(ConstraintKind::Midpoint, std::move(id)),
        point(std::move(point_)), line(std::move(line_)) {}
  SketchEntityId point, line;
};

struct SymmetricConstraint final : SketchConstraint {
  SymmetricConstraint(SketchConstraintId id, SketchEntityId a_, SketchEntityId b_,
                      SketchEntityId axis_)
      : SketchConstraint(ConstraintKind::Symmetric, std::move(id)),
        a(std::move(a_)), b(std::move(b_)), axis(std::move(axis_)) {}
  SketchEntityId a, b, axis;
};

struct FixConstraint final : SketchConstraint {
  FixConstraint(SketchConstraintId id, SketchEntityId point_)
      : SketchConstraint(ConstraintKind::Fix, std::move(id)), point(std::move(point_)) {}
  SketchEntityId point;
};

/**
 * Where a dimension is drawn (spec 12 "Kóty (M28)"); display data only, the solver ignores it.
 * JSON { kind: "linear", offset, along } | { kind: "radial", angle, distance } |
 * { kind: "angular", radius, t }; only the fields of the kind are meaningful.
 */
struct DimensionPlacement {
  enum class Kind { Linear, Radial, Angular };
  Kind kind = Kind::Linear;
  double offset = 0, along = 0;    // Linear
  double angle = 0, distance = 0;  // Radial
  double radius = 0, t = 0;        // Angular
};

/** distance, hDistance, vDistance of two points; value > 0. */
struct DistanceConstraint final : SketchConstraint {
  DistanceConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId a_,
                     SketchEntityId b_, double value_, std::optional<DimensionPlacement> placement_)
      : SketchConstraint(kind, std::move(id)),
        a(std::move(a_)), b(std::move(b_)), value(value_), placement(placement_) {}
  SketchEntityId a, b;
  double value;
  std::optional<DimensionPlacement> placement;
};

/** The distance of a point to the infinite line of a line or an xline; value > 0. */
struct PointLineDistanceConstraint final : SketchConstraint {
  PointLineDistanceConstraint(SketchConstraintId id, SketchEntityId point_, SketchEntityId line_,
                              double value_, std::optional<DimensionPlacement> placement_)
      : SketchConstraint(ConstraintKind::PointLineDistance, std::move(id)),
        point(std::move(point_)), line(std::move(line_)), value(value_), placement(placement_) {}
  SketchEntityId point, line;
  double value;
  std::optional<DimensionPlacement> placement;
};

/** The angle between two lines or xlines, 0 < value < π, each direction reversed by its flag. */
struct AngleConstraint final : SketchConstraint {
  AngleConstraint(SketchConstraintId id, SketchEntityId a_, SketchEntityId b_, double value_,
                  bool reverseA_, bool reverseB_, std::optional<DimensionPlacement> placement_)
      : SketchConstraint(ConstraintKind::Angle, std::move(id)),
        a(std::move(a_)), b(std::move(b_)), value(value_), reverseA(reverseA_), reverseB(reverseB_),
        placement(placement_) {}
  SketchEntityId a, b;
  double value;
  bool reverseA;
  bool reverseB;
  std::optional<DimensionPlacement> placement;
};

/** radius / diameter of a circle or an arc. */
struct RadialConstraint final : SketchConstraint {
  RadialConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId curve_, double value_,
                   std::optional<DimensionPlacement> placement_)
      : SketchConstraint(kind, std::move(id)),
        curve(std::move(curve_)), value(value_), placement(placement_) {}
  SketchEntityId curve;
  double value;
  std::optional<DimensionPlacement> placement;
};

struct OffsetPair {
  SketchEntityId source, copy;
};

/** An associative offset (M35): each copy keeps the distance value from its source. */
struct OffsetConstraint final : SketchConstraint {
  OffsetConstraint(SketchConstraintId id, std::vector<OffsetPair> pairs_, double value_,
                   std::optional<DimensionPlacement> placement_)
      : SketchConstraint(ConstraintKind::Offset, std::move(id)),
        pairs(std::move(pairs_)), value(value_), placement(placement_) {}
  std::vector<OffsetPair> pairs;
  double value;
  std::optional<DimensionPlacement> placement;
};

}  // namespace tinycad::sketch
