#include "tinycad/core/curve2.hpp"

#include <utility>

namespace tinycad::core {

Curve2 Curve2::line(Vec2 from, Vec2 to, std::string id) {
  Curve2 c;
  c.kind = Kind::Line;
  c.from = from;
  c.to = to;
  c.id = std::move(id);
  return c;
}

Curve2 Curve2::arc(Vec2 center, Vec2 from, Vec2 to, bool ccw, std::string id) {
  Curve2 c;
  c.kind = Kind::Arc;
  c.center = center;
  c.from = from;
  c.to = to;
  c.ccw = ccw;
  c.id = std::move(id);
  return c;
}

Curve2 Curve2::circle(Vec2 center, double radius, std::string id) {
  Curve2 c;
  c.kind = Kind::Circle;
  c.center = center;
  c.radius = radius;
  c.id = std::move(id);
  return c;
}

Curve2 Curve2::bspline(int degree, std::vector<Vec2> poles, std::vector<double> knots,
                       std::string id) {
  Curve2 c;
  c.kind = Kind::BSpline;
  c.degree = degree;
  c.poles = std::move(poles);
  c.knots = std::move(knots);
  c.id = std::move(id);
  return c;
}

const char* Curve2::kindName() const {
  switch (kind) {
    case Kind::Line:
      return "line";
    case Kind::Arc:
      return "arc";
    case Kind::Circle:
      return "circle";
    case Kind::BSpline:
      break;
  }
  return "bspline";
}

}  // namespace tinycad::core
