// The kind names and the kind groups of the sketch model (src/sketch/model.ts).

#include "tinycad/sketch/model.hpp"

#include <cmath>
#include <numbers>

namespace tinycad::sketch {

std::string_view entityKindName(EntityKind kind) {
  switch (kind) {
    case EntityKind::Point:
      return "point";
    case EntityKind::Line:
      return "line";
    case EntityKind::Circle:
      return "circle";
    case EntityKind::Arc:
      return "arc";
    case EntityKind::BSpline:
      return "bspline";
    case EntityKind::FitSpline:
      return "fitSpline";
    case EntityKind::XLine:
      return "xline";
    case EntityKind::Mirror:
      return "mirror";
    case EntityKind::LinearPattern:
      return "linearPattern";
    case EntityKind::CircularPattern:
      return "circularPattern";
    case EntityKind::Text:
      break;
  }
  return "text";
}

bool SketchEntity::isPattern() const {
  switch (kind_) {
    case EntityKind::Mirror:
    case EntityKind::LinearPattern:
    case EntityKind::CircularPattern:
      return true;
    default:
      return false;
  }
}

bool SketchEntity::isCurve() const {
  return kind_ != EntityKind::Point && !isPattern() && kind_ != EntityKind::Text;
}

bool SketchEntity::isLineCarrier() const {
  return kind_ == EntityKind::Line || kind_ == EntityKind::XLine;
}

bool SketchEntity::isPatternSource() const {
  switch (kind_) {
    case EntityKind::Point:
    case EntityKind::Line:
    case EntityKind::Circle:
    case EntityKind::Arc:
    case EntityKind::BSpline:
    case EntityKind::FitSpline:
    case EntityKind::XLine:
      return true;
    case EntityKind::Mirror:
    case EntityKind::LinearPattern:
    case EntityKind::CircularPattern:
    case EntityKind::Text:
      break;
  }
  return false;
}

double SketchCircularPattern::step() const {
  const bool full = std::abs(std::abs(angle) - 2 * std::numbers::pi) <= FULL_CIRCLE_TOLERANCE;
  return full ? angle / count : angle / (count - 1);
}

std::string_view constraintKindName(ConstraintKind kind) {
  switch (kind) {
    case ConstraintKind::Coincident:
      return "coincident";
    case ConstraintKind::Horizontal:
      return "horizontal";
    case ConstraintKind::Vertical:
      return "vertical";
    case ConstraintKind::Parallel:
      return "parallel";
    case ConstraintKind::Perpendicular:
      return "perpendicular";
    case ConstraintKind::Equal:
      return "equal";
    case ConstraintKind::Tangent:
      return "tangent";
    case ConstraintKind::PointOnCurve:
      return "pointOnCurve";
    case ConstraintKind::Midpoint:
      return "midpoint";
    case ConstraintKind::HAlign:
      return "hAlign";
    case ConstraintKind::VAlign:
      return "vAlign";
    case ConstraintKind::Symmetric:
      return "symmetric";
    case ConstraintKind::Fix:
      return "fix";
    case ConstraintKind::Distance:
      return "distance";
    case ConstraintKind::HDistance:
      return "hDistance";
    case ConstraintKind::VDistance:
      return "vDistance";
    case ConstraintKind::PointLineDistance:
      return "pointLineDistance";
    case ConstraintKind::Angle:
      return "angle";
    case ConstraintKind::Radius:
      return "radius";
    case ConstraintKind::Diameter:
      return "diameter";
    case ConstraintKind::Offset:
      break;
  }
  return "offset";
}

bool SketchConstraint::isDimension() const {
  switch (kind_) {
    case ConstraintKind::Distance:
    case ConstraintKind::HDistance:
    case ConstraintKind::VDistance:
    case ConstraintKind::PointLineDistance:
    case ConstraintKind::Angle:
    case ConstraintKind::Radius:
    case ConstraintKind::Diameter:
    case ConstraintKind::Offset:
      return true;
    default:
      return false;
  }
}

}  // namespace tinycad::sketch
