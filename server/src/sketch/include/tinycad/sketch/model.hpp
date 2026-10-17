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

  /** The concrete type; the caller has checked kind(). */
  template <class T>
  [[nodiscard]] const T& as() const {
    return static_cast<const T&>(*this);
  }

 protected:
  SketchEntity(EntityKind kind, SketchEntityId id) : kind_(kind), id_(std::move(id)) {}

 private:
  EntityKind kind_;
  SketchEntityId id_;
};

using EntityPtr = std::shared_ptr<const SketchEntity>;

struct SketchPoint final : SketchEntity {
  SketchPoint(SketchEntityId id, double x, double y)
      : SketchEntity(EntityKind::Point, std::move(id)), x(x), y(y) {}
  double x;
  double y;
};

/** `construction` = the TS optional `construction?: true` (false = absent in JSON). */
struct SketchLine final : SketchEntity {
  SketchLine(SketchEntityId id, SketchEntityId p1, SketchEntityId p2, bool construction)
      : SketchEntity(EntityKind::Line, std::move(id)),
        p1(std::move(p1)), p2(std::move(p2)), construction(construction) {}
  SketchEntityId p1, p2;
  bool construction;
};

struct SketchCircle final : SketchEntity {
  SketchCircle(SketchEntityId id, SketchEntityId center, double radius, bool construction)
      : SketchEntity(EntityKind::Circle, std::move(id)),
        center(std::move(center)), radius(radius), construction(construction) {}
  SketchEntityId center;
  double radius;
  bool construction;
};

/** Counter-clockwise from start to end around center. */
struct SketchArc final : SketchEntity {
  SketchArc(SketchEntityId id, SketchEntityId center, SketchEntityId start, SketchEntityId end,
            bool construction)
      : SketchEntity(EntityKind::Arc, std::move(id)),
        center(std::move(center)), start(std::move(start)), end(std::move(end)),
        construction(construction) {}
  SketchEntityId center, start, end;
  bool construction;
};

/** A spline through control points: degree = min(3, poles − 1), clamped knots from 0 to 1. */
struct SketchBSpline final : SketchEntity {
  SketchBSpline(SketchEntityId id, int degree, std::vector<SketchEntityId> poles,
                std::vector<double> knots, bool construction)
      : SketchEntity(EntityKind::BSpline, std::move(id)),
        degree(degree), poles(std::move(poles)), knots(std::move(knots)),
        construction(construction) {}
  int degree;
  /** Sketch points, ≥ 2, distinct. */
  std::vector<SketchEntityId> poles;
  std::vector<double> knots;
  bool construction;
};

/** A spline through points; its solved poles are stored (regen never calls the solver). */
struct SketchFitSpline final : SketchEntity {
  SketchFitSpline(SketchEntityId id, int degree, std::vector<SketchEntityId> fit,
                  std::vector<double> params, std::vector<Vec2> poles, std::vector<double> knots,
                  bool construction)
      : SketchEntity(EntityKind::FitSpline, std::move(id)),
        degree(degree), fit(std::move(fit)), params(std::move(params)), poles(std::move(poles)),
        knots(std::move(knots)), construction(construction) {}
  int degree;
  std::vector<SketchEntityId> fit;
  std::vector<double> params;
  std::vector<Vec2> poles;
  std::vector<double> knots;
  bool construction;
};

/** A construction line without ends through two points (M31); always construction (JSON `true`). */
struct SketchXLine final : SketchEntity {
  SketchXLine(SketchEntityId id, SketchEntityId p1, SketchEntityId p2)
      : SketchEntity(EntityKind::XLine, std::move(id)), p1(std::move(p1)), p2(std::move(p2)) {}
  SketchEntityId p1, p2;
};

/** Mirror of the sources across the axis (a line or an xline), M36. */
struct SketchMirror final : SketchEntity {
  SketchMirror(SketchEntityId id, std::vector<SketchEntityId> sources, SketchEntityId axis)
      : SketchEntity(EntityKind::Mirror, std::move(id)),
        sources(std::move(sources)), axis(std::move(axis)) {}
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
  SketchLinearPattern(SketchEntityId id, std::vector<SketchEntityId> sources,
                      PatternDirection direction1, std::optional<PatternDirection> direction2)
      : SketchEntity(EntityKind::LinearPattern, std::move(id)),
        sources(std::move(sources)), direction1(direction1), direction2(direction2) {}
  std::vector<SketchEntityId> sources;
  PatternDirection direction1;
  std::optional<PatternDirection> direction2;
};

struct SketchCircularPattern final : SketchEntity {
  SketchCircularPattern(SketchEntityId id, std::vector<SketchEntityId> sources,
                        SketchEntityId center, int count, double angle)
      : SketchEntity(EntityKind::CircularPattern, std::move(id)),
        sources(std::move(sources)), center(std::move(center)), count(count), angle(angle) {}
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
  SketchText(SketchEntityId id, std::string text, TextFont font, double height,
             SketchEntityId baseline, std::vector<TextContour> contours, bool construction)
      : SketchEntity(EntityKind::Text, std::move(id)),
        text(std::move(text)), font(font), height(height), baseline(std::move(baseline)),
        contours(std::move(contours)), construction(construction) {}
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

  template <class T>
  [[nodiscard]] const T& as() const {
    return static_cast<const T&>(*this);
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
  PairConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId a, SketchEntityId b)
      : SketchConstraint(kind, std::move(id)), a(std::move(a)), b(std::move(b)) {}
  SketchEntityId a, b;
};

/** horizontal / vertical of a line or an xline. */
struct LineConstraint final : SketchConstraint {
  LineConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId line)
      : SketchConstraint(kind, std::move(id)), line(std::move(line)) {}
  SketchEntityId line;
};

/** A point on the carrier of a line/xline, the circle of an arc or a spline within its ends. */
struct PointOnCurveConstraint final : SketchConstraint {
  PointOnCurveConstraint(SketchConstraintId id, SketchEntityId point, SketchEntityId curve)
      : SketchConstraint(ConstraintKind::PointOnCurve, std::move(id)),
        point(std::move(point)), curve(std::move(curve)) {}
  SketchEntityId point, curve;
};

/** A point in the middle of a line (not an xline). */
struct MidpointConstraint final : SketchConstraint {
  MidpointConstraint(SketchConstraintId id, SketchEntityId point, SketchEntityId line)
      : SketchConstraint(ConstraintKind::Midpoint, std::move(id)),
        point(std::move(point)), line(std::move(line)) {}
  SketchEntityId point, line;
};

struct SymmetricConstraint final : SketchConstraint {
  SymmetricConstraint(SketchConstraintId id, SketchEntityId a, SketchEntityId b,
                      SketchEntityId axis)
      : SketchConstraint(ConstraintKind::Symmetric, std::move(id)),
        a(std::move(a)), b(std::move(b)), axis(std::move(axis)) {}
  SketchEntityId a, b, axis;
};

struct FixConstraint final : SketchConstraint {
  FixConstraint(SketchConstraintId id, SketchEntityId point)
      : SketchConstraint(ConstraintKind::Fix, std::move(id)), point(std::move(point)) {}
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
  DistanceConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId a,
                     SketchEntityId b, double value, std::optional<DimensionPlacement> placement)
      : SketchConstraint(kind, std::move(id)),
        a(std::move(a)), b(std::move(b)), value(value), placement(placement) {}
  SketchEntityId a, b;
  double value;
  std::optional<DimensionPlacement> placement;
};

/** The distance of a point to the infinite line of a line or an xline; value > 0. */
struct PointLineDistanceConstraint final : SketchConstraint {
  PointLineDistanceConstraint(SketchConstraintId id, SketchEntityId point, SketchEntityId line,
                              double value, std::optional<DimensionPlacement> placement)
      : SketchConstraint(ConstraintKind::PointLineDistance, std::move(id)),
        point(std::move(point)), line(std::move(line)), value(value), placement(placement) {}
  SketchEntityId point, line;
  double value;
  std::optional<DimensionPlacement> placement;
};

/** The angle between two lines or xlines, 0 < value < π, each direction reversed by its flag. */
struct AngleConstraint final : SketchConstraint {
  AngleConstraint(SketchConstraintId id, SketchEntityId a, SketchEntityId b, double value,
                  bool reverseA, bool reverseB, std::optional<DimensionPlacement> placement)
      : SketchConstraint(ConstraintKind::Angle, std::move(id)),
        a(std::move(a)), b(std::move(b)), value(value), reverseA(reverseA), reverseB(reverseB),
        placement(placement) {}
  SketchEntityId a, b;
  double value;
  bool reverseA;
  bool reverseB;
  std::optional<DimensionPlacement> placement;
};

/** radius / diameter of a circle or an arc. */
struct RadialConstraint final : SketchConstraint {
  RadialConstraint(ConstraintKind kind, SketchConstraintId id, SketchEntityId curve, double value,
                   std::optional<DimensionPlacement> placement)
      : SketchConstraint(kind, std::move(id)),
        curve(std::move(curve)), value(value), placement(placement) {}
  SketchEntityId curve;
  double value;
  std::optional<DimensionPlacement> placement;
};

struct OffsetPair {
  SketchEntityId source, copy;
};

/** An associative offset (M35): each copy keeps the distance value from its source. */
struct OffsetConstraint final : SketchConstraint {
  OffsetConstraint(SketchConstraintId id, std::vector<OffsetPair> pairs, double value,
                   std::optional<DimensionPlacement> placement)
      : SketchConstraint(ConstraintKind::Offset, std::move(id)),
        pairs(std::move(pairs)), value(value), placement(placement) {}
  std::vector<OffsetPair> pairs;
  double value;
  std::optional<DimensionPlacement> placement;
};

}  // namespace tinycad::sketch
