// offsetCurves (port of src/kernel-occt/offset.ts, spec 06 "Stav po M35"): the chain as a wire on
// its own planar face (BRepBuilderAPI_MakeFace(gp_Pln, wire, true): from the wire alone even a
// single line fails), BRepOffsetAPI_MakeOffset with GeomAbs_Intersection (sharp corners) and
// isOpenResult = !closed. Its edges come in no particular order and orientation, so they are
// chained by their ends and turned along the input (offset_chain.cpp); `source` comes from
// Generated of the input edges. Where sharp corners next to a spline fail, the corners are round
// (GeomAbs_Arc).

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_JoinType.hxx>
#include <Geom_BSplineCurve.hxx>
#include <NCollection_Array1.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <map>
#include <optional>
#include <set>

#include "tinycad/occt2d/curves.hpp"

#include "algorithms.hpp"
#include "offset_chain.hpp"

namespace tinycad::geometry::detail {

using occt2d::CompressedKnots;
using occt2d::compressKnots;
using occt2d::dist;
using occt2d::Kind;
using occt2d::kTurn;
using occt2d::scaleOf;

namespace {

/** Ends of two output edges within this · the scale are one vertex of the offset. */
constexpr double kJoinTolerance = 1e-6;

/** An edge of the wire built from an input curve, with the id of that curve. */
struct IdEdge {
  TopoDS_Edge edge;
  std::string id;
};

/** A sketch point on the sketch plane: sketch coordinates are the x, y of the world (z = 0). */
gp_Pnt point(Vec2 v) { return {v[0], v[1], 0}; }

gp_Circ circleOf(Vec2 center, double radius) {
  return {gp_Ax2(point(center), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), radius};
}

TopoDS_Edge done(BRepBuilderAPI_MakeEdge&& maker) {
  if (!maker.IsDone()) throw offsetFailure("an edge could not be built");
  return maker.Edge();
}

/** The edge of a spline on the sketch plane: a non-rational Geom_BSplineCurve. */
TopoDS_Edge splineEdge(const Curve2& spline) {
  const CompressedKnots compressed = compressKnots(spline.knots);
  const int poleCount = static_cast<int>(spline.poles.size());
  const int knotCount = static_cast<int>(compressed.knots.size());
  NCollection_Array1<gp_Pnt> poles(1, poleCount);
  for (int i = 0; i < poleCount; ++i) {
    poles.SetValue(i + 1, point(spline.poles[static_cast<std::size_t>(i)]));
  }
  NCollection_Array1<double> knotArray(1, knotCount);
  NCollection_Array1<int> multArray(1, knotCount);
  for (int i = 0; i < knotCount; ++i) {
    knotArray.SetValue(i + 1, compressed.knots[static_cast<std::size_t>(i)]);
    multArray.SetValue(i + 1, compressed.multiplicities[static_cast<std::size_t>(i)]);
  }
  const Handle(Geom_BSplineCurve) curve =
      new Geom_BSplineCurve(poles, knotArray, multArray, spline.degree, false);
  return done(BRepBuilderAPI_MakeEdge(curve));
}

/** The edge of a curve on the sketch plane (port of edge in src/kernel-occt/face.ts). */
TopoDS_Edge edgeOf(const Curve2& c) {
  switch (c.kind) {
    case Kind::Line:
      return done(BRepBuilderAPI_MakeEdge(point(c.from), point(c.to)));
    case Kind::Arc: {
      const gp_Circ circle = circleOf(c.center, dist(c.from, c.center));
      // An OCCT circle runs counter-clockwise about the normal: a clockwise arc is the
      // counter-clockwise arc from `to` to `from`.
      if (c.ccw) return done(BRepBuilderAPI_MakeEdge(circle, point(c.from), point(c.to)));
      return done(BRepBuilderAPI_MakeEdge(circle, point(c.to), point(c.from)));
    }
    case Kind::Circle:
      return done(BRepBuilderAPI_MakeEdge(circleOf(c.center, c.radius)));
    case Kind::BSpline:
      break;
  }
  return splineEdge(c);
}

/**
 * The wire of the chain; for each curve the edge as it is in the wire (MakeWire.Edge(),
 * possibly a copy with merged vertices) goes to `idEdges`.
 */
TopoDS_Wire wireOf(const std::vector<Curve2>& curves, std::vector<IdEdge>& idEdges) {
  BRepBuilderAPI_MakeWire maker;
  for (const Curve2& c : curves) {
    maker.Add(edgeOf(c));
    if (!c.id.empty() && maker.IsDone()) idEdges.push_back({maker.Edge(), c.id});
  }
  if (!maker.IsDone()) throw offsetFailure("a loop does not form a wire");
  return maker.Wire();
}

/** The distinct edges of a shape in the order of TopExp_Explorer. */
std::vector<TopoDS_Shape> edgesOf(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Shape> found;
  for (TopExp_Explorer explorer(shape, TopAbs_EDGE); explorer.More(); explorer.Next()) {
    const TopoDS_Shape& current = explorer.Current();
    const bool duplicate = std::any_of(found.begin(), found.end(),
                                       [&](const TopoDS_Shape& s) { return s.IsSame(current); });
    if (!duplicate) found.push_back(current);
  }
  return found;
}

/** Output edge index → id of the input edge that Generated it (an edge of a join has none). */
std::map<std::size_t, std::string> sourcesOf(BRepOffsetAPI_MakeOffset& maker,
                                             const std::vector<IdEdge>& inputs,
                                             const std::vector<TopoDS_Shape>& outputs) {
  std::map<std::size_t, std::string> sources;
  for (const auto& [edge, id] : inputs) {
    for (const TopoDS_Shape& item : maker.Generated(edge)) {
      const auto it = std::find_if(outputs.begin(), outputs.end(),
                                   [&](const TopoDS_Shape& s) { return s.IsSame(item); });
      if (it != outputs.end()) sources[static_cast<std::size_t>(it - outputs.begin())] = id;
    }
  }
  return sources;
}

/** The output edge as a piece: a line, an arc or a circle exactly, anything else sampled. */
Piece pieceOf(const TopoDS_Shape& shape, const std::string& source) {
  const TopoDS_Edge edge = TopoDS::Edge(shape);
  const BRepAdaptor_Curve curve(edge);
  const double u0 = curve.FirstParameter();
  const double u1 = curve.LastParameter();
  const auto at = [&](double u) -> Vec2 {
    const gp_Pnt p = curve.Value(u);
    return {p.X(), p.Y()};
  };
  Piece piece;
  piece.from = at(u0);
  piece.to = at(u1);
  piece.source = source;
  switch (curve.GetType()) {
    case GeomAbs_Line:
      piece.kind = Piece::Kind::Line;
      return piece;
    case GeomAbs_Circle: {
      const gp_Circ circle = curve.Circle();
      piece.center = {circle.Location().X(), circle.Location().Y()};
      if (u1 - u0 >= kTurn - 1e-9) {
        piece.kind = Piece::Kind::Circle;
        piece.radius = circle.Radius();
        return piece;
      }
      // The circle runs counter-clockwise about its axis; the axis may point down.
      piece.kind = Piece::Kind::Arc;
      piece.ccw = circle.Axis().Direction().Z() > 0;
      return piece;
    }
    default:
      piece.kind = Piece::Kind::Sampled;
      piece.sample = [edge, u0, u1](int n) {
        const BRepAdaptor_Curve adaptor(edge);
        std::vector<Vec2> points;
        for (int k = 0; k <= n; ++k) {
          const gp_Pnt p = adaptor.Value(u0 + ((u1 - u0) * k) / n);
          points.push_back({p.X(), p.Y()});
        }
        return points;
      };
      return piece;
  }
}

bool hasSpline(const std::vector<Curve2>& curves) {
  return std::any_of(curves.begin(), curves.end(),
                     [](const Curve2& c) { return c.kind == Kind::BSpline; });
}

/** The ids of the input curves kept by the offset with round corners (none when it fails). */
std::set<std::string> arcJoinSources(const TopoDS_Face& face, const std::vector<IdEdge>& inputs,
                                     bool closed, double distance) {
  BRepOffsetAPI_MakeOffset maker(face, GeomAbs_Arc, !closed);
  maker.Perform(distance, 0);
  if (!maker.IsDone()) return {};
  const std::vector<TopoDS_Shape> outputs = edgesOf(maker.Shape());
  std::set<std::string> kept;
  for (const auto& [index, id] : sourcesOf(maker, inputs, outputs)) kept.insert(id);
  return kept;
}

/** The offset with the given corners. */
std::vector<OffsetCurve> offsetWith(const std::vector<Curve2>& curves, bool closed,
                                    double distance, double scale, GeomAbs_JoinType join) {
  std::vector<IdEdge> inputs;
  const TopoDS_Wire wire = wireOf(curves, inputs);
  const BRepBuilderAPI_MakeFace faceMaker(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), wire, true);
  if (!faceMaker.IsDone()) throw offsetFailure("the chain gives no face");
  const TopoDS_Face face = faceMaker.Face();
  // A closed chain with isOpenResult = true gives half of the edges (prototype M35).
  BRepOffsetAPI_MakeOffset maker(face, join, !closed);
  maker.Perform(distance, 0);
  if (!maker.IsDone()) throw offsetFailure("OCCT cannot offset the chain");
  const std::vector<TopoDS_Shape> outputs = edgesOf(maker.Shape());
  if (outputs.empty()) throw offsetFailure("nothing is left of the chain");
  const auto sources = sourcesOf(maker, inputs, outputs);
  if (join == GeomAbs_Intersection && hasSpline(curves)) {
    // GeomAbs_Intersection cannot extend the offset of a spline into a sharp corner: it drops
    // curves (and returns IsDone) instead. With GeomAbs_Arc no curve vanishes that a sharp
    // corner would keep, so a curve missing here but kept there means a broken result.
    std::set<std::string> kept;
    for (const auto& [index, id] : sources) kept.insert(id);
    for (const std::string& id : arcJoinSources(face, inputs, closed, distance)) {
      if (!kept.contains(id)) {
        throw offsetFailure("OCCT cannot make a sharp corner next to the offset of a spline");
      }
    }
  }
  std::vector<Piece> pieces;
  for (std::size_t i = 0; i < outputs.size(); ++i) {
    const auto it = sources.find(i);
    pieces.push_back(pieceOf(outputs[i], it == sources.end() ? std::string() : it->second));
  }
  if (pieces.front().kind == Piece::Kind::Circle) {
    if (pieces.size() > 1) throw offsetFailure("the offset is not one chain");
    const Piece& only = pieces.front();
    return {{Curve2::circle(only.center, only.radius), only.source}};
  }
  if (std::any_of(pieces.begin(), pieces.end(),
                  [](const Piece& p) { return p.kind == Piece::Kind::Circle; })) {
    throw offsetFailure("the offset is not one chain");
  }
  const std::vector<Piece> chain =
      alongInput(chained(std::move(pieces), closed, kJoinTolerance * scale), curves);
  return curvesOf(closed ? fromFirst(chain, curves) : chain, closed, scale);
}

/** The offset by `distance` as OCCT takes it: sharp corners, round ones when those fail next to a spline. */
std::vector<OffsetCurve> offsetOnce(const std::vector<Curve2>& curves, bool closed,
                                    double distance, double scale) {
  if (!hasSpline(curves)) return offsetWith(curves, closed, distance, scale, GeomAbs_Intersection);
  try {
    return offsetWith(curves, closed, distance, scale, GeomAbs_Intersection);
  } catch (const Failure& e) {
    if (e.code() != ErrorCode::OperationFailed) throw;
    return offsetWith(curves, closed, distance, scale, GeomAbs_Arc);
  }
}

/** An offset or its 'operation-failed'. */
struct Attempt {
  std::optional<std::vector<OffsetCurve>> curves;
  std::optional<Failure> error;
};

}  // namespace

std::vector<OffsetCurve> offsetOf(const std::vector<Curve2>& chain, bool closed,
                                  double distance) {
  const double scale = scaleOf(chain, distance);
  // A closed chain: OCCT takes > 0 outwards whatever its orientation.
  if (closed) return offsetOnce(chain, closed, distance, scale);
  // An open one: OCCT takes the right side of its wire, which runs against the chain when it
  // starts with a clockwise arc, and a single arc it offsets towards its center for > 0 either
  // way. So the side is checked on the result, and the other sign tried when it is wrong (or
  // failed: it may have been the wrong side).
  const auto attempt = [&](double d) -> Attempt {
    try {
      return {offsetOnce(chain, closed, d, scale), std::nullopt};
    } catch (const Failure& e) {
      if (e.code() != ErrorCode::OperationFailed) throw;
      return {std::nullopt, e};
    }
  };
  const bool wanted = distance > 0;
  const Attempt first = attempt(distance);
  if (first.curves && onRight(*first.curves, chain) == wanted) return *first.curves;
  const Attempt second = attempt(-distance);
  if (second.curves && onRight(*second.curves, chain) == wanted) return *second.curves;
  if (first.error) throw *first.error;
  if (second.error) throw *second.error;
  throw offsetFailure("the offset has no side");
}

}  // namespace tinycad::geometry::detail
