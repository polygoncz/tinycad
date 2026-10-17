#include "gcs_wrapper.hpp"

#include <stdexcept>

namespace tinycad::solver_planegcs {

namespace {

constexpr int NO_DEBUG = 0;
constexpr int DOG_LEG = 2;

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }

/** The offset of a property within the p-params of a geometry (geom_params.ts). */
int propertyOffset(PrimitiveType type, const std::string& property) {
  if (type == PrimitiveType::Point && property == "x") return 0;
  if (type == PrimitiveType::Point && property == "y") return 1;
  if (type == PrimitiveType::Circle && property == "radius") return 0;
  if (type == PrimitiveType::Arc && property == "start_angle") return 0;
  if (type == PrimitiveType::Arc && property == "end_angle") return 1;
  if (type == PrimitiveType::Arc && property == "radius") return 2;
  fail("Unknown property " + property);
}

}  // namespace

// --- Geometry: the C++ side of the type check Embind does when the wrapper passes an object.

GCS::Point& GcsWrapper::Geometry::asPoint() {
  if (type != PrimitiveType::Point) fail("not a point");
  return point;
}

GCS::Line& GcsWrapper::Geometry::asLine() {
  if (type != PrimitiveType::Line) fail("not a line");
  return line;
}

GCS::Circle& GcsWrapper::Geometry::asCircle() {
  if (type != PrimitiveType::Circle) fail("not a circle");
  return circle;
}

GCS::Arc& GcsWrapper::Geometry::asArc() {
  if (type != PrimitiveType::Arc) fail("not an arc");
  return arc;
}

GCS::BSpline& GcsWrapper::Geometry::asBSpline() {
  if (type != PrimitiveType::BSpline || bspline == nullptr) fail("not a bspline");
  return *bspline;
}

GCS::Curve& GcsWrapper::Geometry::asCurve() {
  switch (type) {
    case PrimitiveType::Line:
      return line;
    case PrimitiveType::Circle:
      return circle;
    case PrimitiveType::Arc:
      return arc;
    case PrimitiveType::BSpline:
      return asBSpline();
    default:
      fail("not a curve");
  }
}

// --- Construction

GcsWrapper::GcsWrapper() {
  // Before pushing: in debug mode planegcs prints (ADR 0016, pitfall 2).
  gcs_.set_debug_mode(NO_DEBUG);
}

GcsWrapper::~GcsWrapper() { gcs_.clear_data(); }

// --- Sketch → GCS

void GcsWrapper::pushSketchParam(const std::string& name, double value, bool fixed) {
  const int pos = gcs_.params_size();
  gcs_.push_p_param(value, fixed);
  sketchParamIndex_[name] = pos;
}

int GcsWrapper::pushParams(const std::string& id, const std::vector<double>& values, bool fixed) {
  const int pos = gcs_.params_size();
  for (double value : values) gcs_.push_p_param(value, fixed);
  paramIndex_.emplace(id, pos);
  return pos;
}

void GcsWrapper::pushPoint(const Primitive& p) {
  if (paramIndex_.contains(p.id)) return;
  pushParams(p.id, {p.x, p.y}, p.fixed);
}

void GcsWrapper::pushPrimitive(const Primitive& o) {
  switch (o.type) {
    case PrimitiveType::Point:
      pushPoint(o);
      break;
    case PrimitiveType::Line:
      pushPoint(sketchPoint(o.refs.at(0)));
      pushPoint(sketchPoint(o.refs.at(1)));
      break;
    case PrimitiveType::Circle:
      pushPoint(sketchPoint(o.refs.at(0)));
      pushParams(o.id, {o.radius}, false);
      break;
    case PrimitiveType::Arc:
      pushPoint(sketchPoint(o.refs.at(0)));
      pushPoint(sketchPoint(o.refs.at(1)));
      pushPoint(sketchPoint(o.refs.at(2)));
      pushParams(o.id, {o.startAngle, o.endAngle, o.radius}, false);
      break;
    case PrimitiveType::BSpline:
      for (const auto& pole : o.refs) pushPoint(sketchPoint(pole));
      break;
    default:
      pushConstraint(o);
  }
  if (index_.contains(o.id)) fail("object with id " + o.id + " already exists");
  index_.emplace(o.id, o);
  primitiveIds_.push_back(o.id);
}

const Primitive& GcsWrapper::primitive(const std::string& id) const {
  const auto it = index_.find(id);
  if (it == index_.end()) fail("sketch object " + id + " not found");
  return it->second;
}

const Primitive& GcsWrapper::sketchPoint(const std::string& id) const {
  const Primitive& p = primitive(id);
  if (p.type != PrimitiveType::Point) fail("sketch object " + id + " is not a sketch point");
  return p;
}

int GcsWrapper::address(const std::string& id) const {
  const auto it = paramIndex_.find(id);
  if (it == paramIndex_.end()) fail("sketch object " + id + " not found in p-params index");
  return it->second;
}

GcsWrapper::Geometry GcsWrapper::makeGeometry(const std::string& id) {
  const Primitive& o = primitive(id);
  Geometry g;
  g.type = o.type;
  switch (o.type) {
    case PrimitiveType::Point: {
      const int p = address(o.id);
      g.point = gcs_.make_point(p, p + 1);
      break;
    }
    case PrimitiveType::Line: {
      const int p1 = address(o.refs.at(0));
      const int p2 = address(o.refs.at(1));
      g.line = gcs_.make_line(p1, p1 + 1, p2, p2 + 1);
      break;
    }
    case PrimitiveType::Circle: {
      const int c = address(o.refs.at(0));
      g.circle = gcs_.make_circle(c, c + 1, address(o.id));
      break;
    }
    case PrimitiveType::Arc: {
      const int c = address(o.refs.at(0));
      const int s = address(o.refs.at(1));
      const int e = address(o.refs.at(2));
      const int a = address(o.id);
      g.arc = gcs_.make_arc(c, c + 1, s, s + 1, e, e + 1, a, a + 1, a + 2);
      break;
    }
    case PrimitiveType::BSpline: {
      const auto cached = bsplines_.find(o.id);
      if (cached != bsplines_.end()) {
        g.bspline = cached->second.get();
        break;
      }
      if (o.refs.size() < 2) fail("BSpline must have at least 2 control points");
      std::vector<int> poles;
      for (const auto& pole : o.refs) {
        const int p = address(pole);
        poles.push_back(p);
        poles.push_back(p + 1);
      }
      const int startx = gcs_.push_p_param(gcs_.get_p_param(poles[0]), false);
      const int starty = gcs_.push_p_param(gcs_.get_p_param(poles[1]), false);
      const int endx = gcs_.push_p_param(gcs_.get_p_param(poles[poles.size() - 2]), false);
      const int endy = gcs_.push_p_param(gcs_.get_p_param(poles[poles.size() - 1]), false);
      std::vector<int> weights;
      for (double w : o.weights) weights.push_back(gcs_.push_p_param(w, true));
      std::vector<int> knots;
      for (double k : o.knots) knots.push_back(gcs_.push_p_param(k, true));
      auto made = std::make_unique<GCS::BSpline>(gcs_.make_bspline(
          startx, starty, endx, endy, poles, weights, knots, o.mult, o.degree, false));
      g.bspline = made.get();
      bsplines_.emplace(o.id, std::move(made));
      break;
    }
    default:
      fail("not-implemented object type of " + o.id);
  }
  return g;
}

int GcsWrapper::paramAddress(const Primitive& c, const ParamValue& value) {
  switch (value.kind) {
    case ParamValue::Kind::Number:
      // A driving constraint: its number is a fixed p-param.
      return pushParams(c.id, {value.number}, true);
    case ParamValue::Kind::SketchParam: {
      const auto it = sketchParamIndex_.find(value.name);
      if (it == sketchParamIndex_.end()) fail("unknown param " + value.name);
      return it->second;
    }
    case ParamValue::Kind::Property: {
      const Primitive& ref = primitive(value.name);
      if (!ref.isGeometry()) fail("Primitive #" + value.name + " cannot be referenced");
      return address(value.name) + propertyOffset(ref.type, value.property);
    }
  }
  fail("unknown param kind");
}

void GcsWrapper::pushConstraint(const Primitive& c) {
  // The tag is the 1-based index of the constraint in the sketch index; -1 for a temporary one.
  const int tag = c.temporary ? -1 : static_cast<int>(primitiveIds_.size()) + 1;
  const bool driving = true;
  // In field order: every constraint the adapter uses has its object params before its numbers.
  std::vector<Geometry> g;
  for (const auto& ref : c.refs) g.push_back(makeGeometry(ref));
  std::vector<int> v;
  for (const auto& value : c.values) v.push_back(paramAddress(c, value));

  using T = PrimitiveType;
  switch (c.type) {
    case T::P2PCoincident:
      gcs_.add_constraint_p2p_coincident(g.at(0).asPoint(), g.at(1).asPoint(), tag, driving);
      break;
    case T::HorizontalL:
      gcs_.add_constraint_horizontal_l(g.at(0).asLine(), tag, driving);
      break;
    case T::VerticalL:
      gcs_.add_constraint_vertical_l(g.at(0).asLine(), tag, driving);
      break;
    case T::HorizontalPP:
      gcs_.add_constraint_horizontal_pp(g.at(0).asPoint(), g.at(1).asPoint(), tag, driving);
      break;
    case T::VerticalPP:
      gcs_.add_constraint_vertical_pp(g.at(0).asPoint(), g.at(1).asPoint(), tag, driving);
      break;
    case T::Parallel:
      gcs_.add_constraint_parallel(g.at(0).asLine(), g.at(1).asLine(), tag, driving);
      break;
    case T::PerpendicularLL:
      gcs_.add_constraint_perpendicular_ll(g.at(0).asLine(), g.at(1).asLine(), tag, driving);
      break;
    case T::EqualLength:
      gcs_.add_constraint_equal_length(g.at(0).asLine(), g.at(1).asLine(), tag, driving);
      break;
    case T::EqualRadiusCC:
      gcs_.add_constraint_equal_radius_cc(g.at(0).asCircle(), g.at(1).asCircle(), tag, driving);
      break;
    case T::EqualRadiusAA:
      gcs_.add_constraint_equal_radius_aa(g.at(0).asArc(), g.at(1).asArc(), tag, driving);
      break;
    case T::EqualRadiusCA:
      gcs_.add_constraint_equal_radius_ca(g.at(0).asCircle(), g.at(1).asArc(), tag, driving);
      break;
    case T::PointOnLinePL:
      gcs_.add_constraint_point_on_line_pl(g.at(0).asPoint(), g.at(1).asLine(), tag, driving);
      break;
    case T::PointOnCircle:
      gcs_.add_constraint_point_on_circle(g.at(0).asPoint(), g.at(1).asCircle(), tag, driving);
      break;
    case T::PointOnArc:
      gcs_.add_constraint_point_on_arc(g.at(0).asPoint(), g.at(1).asArc(), tag, driving);
      break;
    case T::PointOnBSpline:
      gcs_.add_constraint_point_on_bspline(g.at(0).asPoint(), g.at(1).asBSpline(), v.at(0), tag,
                                           driving);
      break;
    case T::TangentLC:
      gcs_.add_constraint_tangent_lc(g.at(0).asLine(), g.at(1).asCircle(), tag, driving);
      break;
    case T::TangentLA:
      gcs_.add_constraint_tangent_la(g.at(0).asLine(), g.at(1).asArc(), tag, driving);
      break;
    case T::TangentCC:
      gcs_.add_constraint_tangent_cc(g.at(0).asCircle(), g.at(1).asCircle(), tag, driving);
      break;
    case T::TangentAA:
      gcs_.add_constraint_tangent_aa(g.at(0).asArc(), g.at(1).asArc(), tag, driving);
      break;
    case T::TangentCA:
      gcs_.add_constraint_tangent_ca(g.at(0).asCircle(), g.at(1).asArc(), tag, driving);
      break;
    case T::AngleViaPoint:
      gcs_.add_constraint_angle_via_point(g.at(0).asCurve(), g.at(1).asCurve(), g.at(2).asPoint(),
                                          v.at(0), tag, driving);
      break;
    case T::P2PSymmetricPPP:
      gcs_.add_constraint_p2p_symmetric_ppp(g.at(0).asPoint(), g.at(1).asPoint(),
                                            g.at(2).asPoint(), tag, driving);
      break;
    case T::P2PSymmetricPPL:
      gcs_.add_constraint_p2p_symmetric_ppl(g.at(0).asPoint(), g.at(1).asPoint(),
                                            g.at(2).asLine(), tag, driving);
      break;
    case T::CoordinateX:
      gcs_.add_constraint_coordinate_x(g.at(0).asPoint(), v.at(0), tag, driving);
      break;
    case T::CoordinateY:
      gcs_.add_constraint_coordinate_y(g.at(0).asPoint(), v.at(0), tag, driving);
      break;
    case T::P2PDistance:
      gcs_.add_constraint_p2p_distance(g.at(0).asPoint(), g.at(1).asPoint(), v.at(0), tag,
                                       driving);
      break;
    case T::P2LDistance:
      gcs_.add_constraint_p2l_distance(g.at(0).asPoint(), g.at(1).asLine(), v.at(0), tag,
                                       driving);
      break;
    case T::L2LAnglePPPP:
      gcs_.add_constraint_l2l_angle_pppp(g.at(0).asPoint(), g.at(1).asPoint(), g.at(2).asPoint(),
                                         g.at(3).asPoint(), v.at(0), tag, driving);
      break;
    case T::Difference:
      gcs_.add_constraint_difference(v.at(0), v.at(1), v.at(2), tag, driving);
      break;
    case T::CircleRadius:
      gcs_.add_constraint_circle_radius(g.at(0).asCircle(), v.at(0), tag, driving);
      break;
    case T::ArcRadius:
      gcs_.add_constraint_arc_radius(g.at(0).asArc(), v.at(0), tag, driving);
      break;
    case T::CircleDiameter:
      gcs_.add_constraint_circle_diameter(g.at(0).asCircle(), v.at(0), tag, driving);
      break;
    case T::ArcDiameter:
      gcs_.add_constraint_arc_diameter(g.at(0).asArc(), v.at(0), tag, driving);
      break;
    case T::ArcRules:
      gcs_.add_constraint_arc_rules(g.at(0).asArc(), tag, driving);
      break;
    default:
      fail("unknown constraint type of " + c.id);
  }
}

// --- Solve and read back

GcsStatus GcsWrapper::solve() { return static_cast<GcsStatus>(gcs_.solve_system(DOG_LEG)); }

void GcsWrapper::applySolution() { gcs_.apply_solution(); }

int GcsWrapper::dof() { return gcs_.dof(); }

std::vector<std::optional<std::string>> GcsWrapper::idsOfTags(const std::vector<int>& tags) const {
  std::vector<std::optional<std::string>> out;
  for (int tag : tags) {
    const bool known = tag >= 1 && tag <= static_cast<int>(primitiveIds_.size());
    out.push_back(known ? std::optional<std::string>(primitiveIds_[tag - 1]) : std::nullopt);
  }
  return out;
}

std::vector<std::optional<std::string>> GcsWrapper::conflicting() {
  return idsOfTags(gcs_.get_conflicting());
}

std::vector<std::optional<std::string>> GcsWrapper::redundant() {
  return idsOfTags(gcs_.get_redundant());
}

std::optional<double> GcsWrapper::sketchParamValue(const std::string& name) {
  const auto it = sketchParamIndex_.find(name);
  if (it == sketchParamIndex_.end()) return std::nullopt;
  return gcs_.get_p_param(it->second);
}

core::Vec2 GcsWrapper::point(const std::string& id) {
  (void)sketchPoint(id);  // the type check of get_sketch_point
  const int at = address(id);
  return {gcs_.get_p_param(at), gcs_.get_p_param(at + 1)};
}

double GcsWrapper::circleRadius(const std::string& id) {
  if (primitive(id).type != PrimitiveType::Circle) fail(id + " is not a sketch circle");
  return gcs_.get_p_param(address(id));
}

}  // namespace tinycad::solver_planegcs
