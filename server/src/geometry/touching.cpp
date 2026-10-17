#include "touching.hpp"

#include <Geom2dAPI_ProjectPointOnCurve.hxx>
#include <gp_Pnt2d.hxx>

#include <cmath>
#include <limits>

namespace tinycad::geometry::detail {

namespace {

/**
 * A piece InterCurveCurve reports as shared is one when the curves are closer than this many
 * tolerances inside it; otherwise it is a tangency.
 */
constexpr double kOverlapGap = 1e-2;
/** Steps of the golden-section search: shrinks the piece by 0.618^60 ≈ 3e-13. */
constexpr int kGoldenSteps = 60;

}  // namespace

bool sharesPiece(const Handle(Geom2d_Curve) & piece, const Handle(Geom2d_Curve) & other,
                 double tol) {
  const double first = piece->FirstParameter();
  const double last = piece->LastParameter();
  for (double s : {0.25, 0.5, 0.75}) {
    const gp_Pnt2d p = piece->Value(first + (last - first) * s);
    Geom2dAPI_ProjectPointOnCurve projection(p, other);
    if (!(projection.NbPoints() > 0 && projection.LowerDistance() <= kOverlapGap * tol)) {
      return false;
    }
  }
  return true;
}

Vec2 touchingPoint(const Handle(Geom2d_Curve) & piece, const Handle(Geom2d_Curve) & other) {
  const auto gap = [&](double u) {
    Geom2dAPI_ProjectPointOnCurve projection(piece->Value(u), other);
    return projection.NbPoints() > 0 ? projection.LowerDistance()
                                     : std::numeric_limits<double>::infinity();
  };
  double lo = piece->FirstParameter();
  double hi = piece->LastParameter();
  const double ratio = (std::sqrt(5.0) - 1) / 2;
  for (int i = 0; i < kGoldenSteps; ++i) {
    const double u1 = hi - ratio * (hi - lo);
    const double u2 = lo + ratio * (hi - lo);
    if (gap(u1) <= gap(u2)) hi = u2;
    else lo = u1;
  }
  const gp_Pnt2d p = piece->Value((lo + hi) / 2);
  return {p.X(), p.Y()};
}

}  // namespace tinycad::geometry::detail
