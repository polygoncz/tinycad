#include "convert.hpp"

#include <cstdint>
#include <limits>

namespace tinycad::service {

namespace v1 = tinycad::v1;
using core::Curve2;

core::Vec2 fromProto(const v1::Vec2& v) { return {v.x(), v.y()}; }

void toProto(core::Vec2 v, v1::Vec2& out) {
  out.set_x(v[0]);
  out.set_y(v[1]);
}

void toProto(const Curve2& curve, v1::Curve2& out) {
  out.set_id(curve.id);
  switch (curve.kind) {
    case Curve2::Kind::Line: {
      auto* line = out.mutable_line();
      toProto(curve.from, *line->mutable_from());
      toProto(curve.to, *line->mutable_to());
      break;
    }
    case Curve2::Kind::Arc: {
      auto* arc = out.mutable_arc();
      toProto(curve.center, *arc->mutable_center());
      toProto(curve.from, *arc->mutable_from());
      toProto(curve.to, *arc->mutable_to());
      arc->set_ccw(curve.ccw);
      break;
    }
    case Curve2::Kind::Circle: {
      auto* circle = out.mutable_circle();
      toProto(curve.center, *circle->mutable_center());
      circle->set_radius(curve.radius);
      break;
    }
    case Curve2::Kind::BSpline: {
      auto* spline = out.mutable_bspline();
      spline->set_degree(static_cast<std::uint32_t>(curve.degree));
      for (const auto& p : curve.poles) toProto(p, *spline->add_poles());
      for (double k : curve.knots) spline->add_knots(k);
      break;
    }
  }
}

bool CurveReader::point(bool present, const v1::Vec2& v, const std::string& path,
                        core::Vec2& out) {
  if (!present) {
    problem_ = path + " is missing";
    return false;
  }
  out = fromProto(v);
  return true;
}

std::optional<Curve2> CurveReader::read(const v1::Curve2& curve, const std::string& path) {
  core::Vec2 center{};
  core::Vec2 from{};
  core::Vec2 to{};
  switch (curve.kind_case()) {
    case v1::Curve2::kLine: {
      const auto& line = curve.line();
      if (!point(line.has_from(), line.from(), path + ".line.from", from) ||
          !point(line.has_to(), line.to(), path + ".line.to", to)) {
        return std::nullopt;
      }
      return Curve2::line(from, to, curve.id());
    }
    case v1::Curve2::kArc: {
      const auto& arc = curve.arc();
      if (!point(arc.has_center(), arc.center(), path + ".arc.center", center) ||
          !point(arc.has_from(), arc.from(), path + ".arc.from", from) ||
          !point(arc.has_to(), arc.to(), path + ".arc.to", to)) {
        return std::nullopt;
      }
      return Curve2::arc(center, from, to, arc.ccw(), curve.id());
    }
    case v1::Curve2::kCircle: {
      const auto& circle = curve.circle();
      if (!point(circle.has_center(), circle.center(), path + ".circle.center", center)) {
        return std::nullopt;
      }
      return Curve2::circle(center, circle.radius(), curve.id());
    }
    case v1::Curve2::kBspline: {
      const auto& spline = curve.bspline();
      // A degree beyond int is outside the range 1..25 the geometry checks anyway.
      const auto maxInt = static_cast<std::uint32_t>(std::numeric_limits<int>::max());
      const int degree = spline.degree() > maxInt ? std::numeric_limits<int>::max()
                                                  : static_cast<int>(spline.degree());
      std::vector<core::Vec2> poles;
      for (const auto& p : spline.poles()) poles.push_back(fromProto(p));
      std::vector<double> knots(spline.knots().begin(), spline.knots().end());
      return Curve2::bspline(degree, poles, knots, curve.id());
    }
    case v1::Curve2::KIND_NOT_SET:
      break;
  }
  problem_ = path + ": the curve has no kind";
  return std::nullopt;
}

std::optional<std::vector<Curve2>> CurveReader::readAll(
    const google::protobuf::RepeatedPtrField<v1::Curve2>& curves, const std::string& path) {
  std::vector<Curve2> out;
  for (int i = 0; i < curves.size(); ++i) {
    auto curve = read(curves.Get(i), path + "[" + std::to_string(i) + "]");
    if (!curve) return std::nullopt;
    out.push_back(*curve);
  }
  return out;
}

}  // namespace tinycad::service
