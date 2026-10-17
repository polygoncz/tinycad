#include "regions.hpp"

#include <GC_MakeSegment2d.hxx>
#include <Geom2dAPI_InterCurveCurve.hxx>
#include <Geom2dAPI_ProjectPointOnCurve.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec2d.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "curves2d.hpp"
#include "guarded.hpp"

// Port of src/kernel-occt/regions.ts (the contract algorithm of the FakeKernel with the
// geometry from OCCT). Curves become Geom2d curves; crossings come from Geom2dAPI_InterCurveCurve
// over the pairs whose bounding boxes overlap (and a spline against itself); tangents and
// curvatures at the nodes from the derivatives of the curves; signed areas by Green's theorem
// (Gauss–Legendre over the first derivative); containment of a hole by the parity of a ray. The
// loops of the result are built from the input curves, not read back from OCCT.

namespace tinycad::kernel::detail {

namespace {

/** Precision::Confusion: the tolerance of intersections and of nodes, times the scale. */
constexpr double kConfusion = 1e-7;
/** Intersection points within this many `tol` of a shared node are matched to it (spec 12). */
constexpr double kNodeMatchFactor = 1e3;
/** Outgoing directions closer than this (radians) are a tie, broken by curvature (spec 12). */
constexpr double kAngleTie = 1e-9;
/** Nodes and weights of the 5-point Gauss–Legendre rule on [−1, 1]: exact up to degree 9. */
constexpr std::array<std::array<double, 2>, 5> kGaussLegendre{{
    {-0.906179845938664, 0.2369268850561891},
    {-0.5384693101056831, 0.4786286704993665},
    {0, 0.5688888888888889},
    {0.5384693101056831, 0.4786286704993665},
    {0.906179845938664, 0.2369268850561891},
}};
/** Pieces of the Green integral per full turn of an arc. */
constexpr double kPiecesPerTurn = 16;
/** The spline degree one Gauss–Legendre piece integrates exactly (x·y' − y·x' of degree ≤ 9). */
constexpr double kExactSplineDegree = 5;
/** Next directions after a degenerate ray: the golden angle keeps them far from each other. */
const double kGoldenAngle = std::numbers::pi * (3 - std::sqrt(5.0));
/** First direction of the containment ray: irrational, so it rarely meets a node. */
const double kRayAngle = std::atan2(std::numbers::pi, std::numbers::sqrt2);
/** Directions tried before the last count is taken as it is. */
constexpr int kRayAttempts = 8;
/** A ray meeting a curve at an angle with a smaller sine only touches it: try another ray. */
constexpr double kGrazingSine = 1e-3;
/** Inward step (part of the parameter range) to a tangent where the derivative vanishes. */
constexpr double kTangentStep = 1e-3;

/**
 * A line, an arc or a spline between two nodes, with its OCCT curve parametrised from `from` to
 * `to` (an arc counter-clockwise). A closed spline is a loop at one node (from == to).
 */
struct Edge {
  Curve2 curve;
  Handle(Geom2d_Curve) g;
  int from = 0;
  int to = 0;
  Box box{};
  /** ∮ (x dy − y dx) / 2 along the curve from `from` to `to`. */
  double green = 0;
};

struct LoneCircle {
  Curve2 curve;
  Handle(Geom2d_Curve) g;
  Box box{};
};

/** One traversal direction of an edge: half-edge 2k runs from → to, 2k + 1 back. */
struct HalfEdge {
  int edge = 0;
  bool forward = true;
  int origin = 0;
  int dest = 0;
  double angle = 0;
  double curvature = 0;
};

/** A closed loop: its half-edges (or a lone circle), signed area, component and box. */
struct Loop {
  std::vector<HalfEdge> halves;
  const LoneCircle* circle = nullptr;
  double area = 0;
  int component = 0;
  Box box{};
};

/** A curve for the crossing check: an edge with its nodes, or a lone circle without any. */
struct CrossingShape {
  Handle(Geom2d_Curve) g;
  Box box{};
  std::vector<int> nodes;
  enum class SelfCheck { None, Open, Closed } selfCheck = SelfCheck::None;
};

/** Direction and signed curvature of a curve leaving a node. */
struct Leaving {
  double angle = 0;
  double curvature = 0;
};

double wrapTurn(double x) {
  const double turn = 2 * std::numbers::pi;
  return std::fmod(std::fmod(x, turn) + turn, turn);
}

/** Angle in [0, 2π); within the tie tolerance of 2π it is 0, so ties do not split at the wrap. */
double direction(double dx, double dy) {
  const double angle = wrapTurn(std::atan2(dy, dx));
  return 2 * std::numbers::pi - angle <= kAngleTie ? 0 : angle;
}

/** Each interval between consecutive values split into `pieces` equal parts. */
std::vector<double> split(const std::vector<double>& values, double pieces) {
  const int n = std::max(1, static_cast<int>(pieces));
  std::vector<double> out;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i + 1 == values.size()) {
      out.push_back(values[i]);
      break;
    }
    const double u = values[i];
    const double next = values[i + 1];
    for (int k = 0; k < n; ++k) out.push_back(u + (next - u) * k / n);
  }
  return out;
}

/**
 * Where the Green integral of a curve is split: a line in one piece, an arc into kPiecesPerTurn
 * pieces per turn, a spline at its knots (each span further for a degree over 5).
 */
std::vector<double> breaksOf(const Curve2& c, const Handle(Geom2d_Curve) & g) {
  const double a = g->FirstParameter();
  const double b = g->LastParameter();
  if (c.kind == Kind::Line) return {a, b};
  if (c.kind == Kind::Arc) return split({a, b}, std::ceil((b - a) / kTurn * kPiecesPerTurn));
  std::vector<double> knots;
  for (const double k : c.knots) {
    if (knots.empty() || knots.back() != k) knots.push_back(k);
  }
  return split(knots, std::ceil(c.degree / kExactSplineDegree));
}

/** ∫ (x y' − y x') / 2 du over the parameter range of `g` split at `breaks` (Gauss–Legendre). */
double greenOf(const Handle(Geom2d_Curve) & g, const std::vector<double>& breaks) {
  double sum = 0;
  gp_Pnt2d p;
  gp_Vec2d v;
  for (std::size_t i = 1; i < breaks.size(); ++i) {
    const double u0 = breaks[i - 1];
    const double half = (breaks[i] - u0) / 2;
    for (const auto& [x, w] : kGaussLegendre) {
      g->D1(u0 + half * (1 + x), p, v);
      sum += w * half * (p.X() * v.Y() - p.Y() * v.X());
    }
  }
  return sum / 2;
}

/**
 * The same curve traversed backwards: a line with swapped ends, an arc clockwise, a spline with
 * the poles reversed and the knots mirrored in their range (k → a + b − k, reversed).
 */
Curve2 reversed(const Curve2& c) {
  switch (c.kind) {
    case Kind::Line:
      return Curve2::line(c.to, c.from, c.id);
    case Kind::Arc:
      return Curve2::arc(c.center, c.to, c.from, !c.ccw, c.id);
    case Kind::Circle:
      return c;
    case Kind::BSpline:
      break;
  }
  const double a = c.knots.front();
  const double b = c.knots.back();
  std::vector<Vec2> poles(c.poles.rbegin(), c.poles.rend());
  std::vector<double> knots;
  for (auto k = c.knots.rbegin(); k != c.knots.rend(); ++k) knots.push_back(a + b - *k);
  return Curve2::bspline(c.degree, std::move(poles), std::move(knots), c.id);
}

/** Whether segment a → b meets the box (slab test). */
bool segmentMeetsBox(Vec2 a, Vec2 b, const Box& box) {
  double t0 = 0;
  double t1 = 1;
  for (std::size_t axis = 0; axis < 2; ++axis) {
    const double start = a[axis];
    const double delta = b[axis] - start;
    const double lo = box[axis];
    const double hi = box[axis + 2];
    if (delta == 0) {
      if (start < lo || start > hi) return false;
      continue;
    }
    const double u = (lo - start) / delta;
    const double w = (hi - start) / delta;
    t0 = std::max(t0, std::min(u, w));
    t1 = std::min(t1, std::max(u, w));
    if (t0 > t1) return false;
  }
  return true;
}

/** The regions of one call: the steps of spec 12 "Oblasti (profily)" over shared state. */
class RegionFinder {
 public:
  explicit RegionFinder(const std::vector<Curve2>& curves) {
    const double scale = scaleOf(curves);
    tol_ = kConfusion * scale;
    nodeTol_ = kNodeMatchFactor * tol_;
    rayLength_ = 4 * scale + 1;
    // 1–2. Curves and nodes: ends closer than tol are one node.
    for (const Curve2& input : curves) {
      const Curve2 curve = counterClockwise(input);
      if (curve.kind == Kind::Circle) {
        circles_.push_back({curve, circleCurve(curve.center, curve.radius), boxOf(curve, tol_)});
        continue;
      }
      const int from = nodeAt(startOf(curve));
      const int to = nodeAt(endOf(curve));
      // Only a spline may close at one node; a line or an arc there has (nearly) zero length.
      if (from == to && curve.kind != Kind::BSpline) continue;
      Handle(Geom2d_Curve) g = boundedCurve(curve);
      const double green = greenOf(g, breaksOf(curve, g));
      edges_.push_back({curve, g, from, to, boxOf(curve, tol_), green});
    }
  }

  ProfileRegions find() {
    // 3. Crossing: a common point other than a shared end node.
    if (crosses()) return {{}, true};

    // 4. Pruning: open chains bound nothing.
    const std::vector<int> alive = prune();

    // 5. Faces by half-edges; signed areas from the Green integrals of the edges.
    std::vector<HalfEdge> halves;
    for (const int e : alive) {
      const auto [forward, back] = halfEdges(e);
      halves.push_back(forward);
      halves.push_back(back);
    }
    const std::vector<int> component = components(alive);
    std::vector<Loop> faces;
    std::vector<Loop> boundaries;
    for (std::vector<HalfEdge>& cycle : traceLoops(halves)) {
      Loop loop;
      loop.component = component[static_cast<std::size_t>(cycle.front().origin)];
      loop.box = edges_[static_cast<std::size_t>(cycle.front().edge)].box;
      for (const HalfEdge& h : cycle) {
        const Edge& e = edges_[static_cast<std::size_t>(h.edge)];
        loop.area += (h.forward ? 1 : -1) * e.green;
        loop.box = unionOf(loop.box, e.box);
      }
      loop.halves = std::move(cycle);
      if (loop.area > 0)
        faces.push_back(std::move(loop));
      else if (loop.area < 0)
        boundaries.push_back(std::move(loop));
    }
    // A lone circle is its own component: one bounded face and its outer boundary.
    for (std::size_t i = 0; i < circles_.size(); ++i) {
      Loop loop;
      loop.circle = &circles_[i];
      loop.component = static_cast<int>(nodes_.size() + i);
      loop.box = circles_[i].box;
      loop.area = std::numbers::pi * circles_[i].curve.radius * circles_[i].curve.radius;
      faces.push_back(loop);
      loop.area = -loop.area;
      boundaries.push_back(loop);
    }

    // 6. Holes: each outer boundary goes to the smallest face of another component containing it.
    std::vector<std::vector<const Loop*>> holes(faces.size());
    for (const Loop& boundary : boundaries) {
      const Vec2 sample = samplePoint(boundary);
      int best = -1;
      for (std::size_t f = 0; f < faces.size(); ++f) {
        const Loop& face = faces[f];
        if (face.component == boundary.component) continue;
        if (best >= 0 && face.area >= faces[static_cast<std::size_t>(best)].area) continue;
        if (contains(face, sample)) best = static_cast<int>(f);
      }
      if (best >= 0) holes[static_cast<std::size_t>(best)].push_back(&boundary);
    }

    // 7. Names from curve ids.
    ProfileRegions result;
    for (std::size_t f = 0; f < faces.size(); ++f) {
      std::set<std::string> ids;
      addIds(faces[f], ids);
      ProfileRegion region;
      region.outer = curvesOf(faces[f]);
      region.area = faces[f].area;
      for (const Loop* hole : holes[f]) {
        addIds(*hole, ids);
        region.holes.push_back(curvesOf(*hole));
        region.area += hole->area;
      }
      for (const std::string& id : ids) region.name += (region.name.empty() ? "" : ",") + id;
      result.regions.push_back(std::move(region));
    }
    std::stable_sort(
        result.regions.begin(), result.regions.end(),
        [](const ProfileRegion& a, const ProfileRegion& b) { return a.name < b.name; });
    return result;
  }

 private:
  int nodeAt(Vec2 p) {
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
      if (dist(nodes_[i], p) <= tol_) return static_cast<int>(i);
    }
    nodes_.push_back(p);
    return static_cast<int>(nodes_.size() - 1);
  }

  [[nodiscard]] const Edge& edgeOf(const HalfEdge& h) const {
    return edges_[static_cast<std::size_t>(h.edge)];
  }

  // --- Crossing ---------------------------------------------------------------------------------

  /**
   * Whether two curves have a common point other than a shared end node, or a spline crosses
   * itself. Only pairs with overlapping boxes reach OCCT.
   */
  bool crosses() {
    std::vector<CrossingShape> shapes;
    for (const Edge& e : edges_) {
      CrossingShape s{e.g, e.box, {e.from, e.to}, CrossingShape::SelfCheck::None};
      if (e.curve.kind == Kind::BSpline) {
        s.selfCheck =
            e.from == e.to ? CrossingShape::SelfCheck::Closed : CrossingShape::SelfCheck::Open;
      }
      shapes.push_back(std::move(s));
    }
    for (const LoneCircle& c : circles_)
      shapes.push_back({c.g, c.box, {}, CrossingShape::SelfCheck::None});
    for (const CrossingShape& s : shapes) {
      if (s.selfCheck != CrossingShape::SelfCheck::None && crossesItself(s)) return true;
    }
    std::vector<Box> boxes;
    for (const CrossingShape& s : shapes) boxes.push_back(s.box);
    for (const auto& [i, j] : overlappingPairs(boxes)) {
      const CrossingShape& a = shapes[i];
      const CrossingShape& b = shapes[j];
      const Geom2dAPI_InterCurveCurve inter(a.g, b.g, tol_);
      if (inter.NbSegments() > 0) return true;
      std::vector<int> shared;
      for (const int n : a.nodes) {
        if (std::find(b.nodes.begin(), b.nodes.end(), n) != b.nodes.end()) shared.push_back(n);
      }
      for (int k = 1; k <= inter.NbPoints(); ++k) {
        const gp_Pnt2d point = inter.Point(k);
        const Vec2 q{point.X(), point.Y()};
        const bool atShared = std::any_of(shared.begin(), shared.end(), [&](int n) {
          return dist(nodes_[static_cast<std::size_t>(n)], q) <= nodeTol_;
        });
        if (!atShared) return true;
      }
    }
    return false;
  }

  /**
   * A spline crosses itself (spec 12 "Spliny (M29)"): any self-intersection or a piece running
   * over itself. A closed spline meets itself in its node; that is a crossing only when the
   * curve also passes through the node inside its parameter range (a figure eight).
   */
  bool crossesItself(const CrossingShape& s) const {
    const Geom2dAPI_InterCurveCurve inter(s.g, tol_);
    if (inter.NbSegments() > 0) return true;
    if (inter.NbPoints() == 0) return false;
    if (s.selfCheck != CrossingShape::SelfCheck::Closed) return true;
    const Vec2 node = nodes_[static_cast<std::size_t>(s.nodes.front())];
    for (int i = 1; i <= inter.NbPoints(); ++i) {
      const gp_Pnt2d point = inter.Point(i);
      if (dist(node, {point.X(), point.Y()}) > nodeTol_) return true;
    }
    return passesInside(s.g, node);
  }

  /** Whether `g` comes within nodeTol of `node` at a parameter clearly inside its range. */
  bool passesInside(const Handle(Geom2d_Curve) & g, Vec2 node) const {
    const double a = g->FirstParameter();
    const double b = g->LastParameter();
    const double margin = kTangentStep * (b - a);
    const Geom2dAPI_ProjectPointOnCurve projection(gp_Pnt2d(node[0], node[1]), g);
    for (int i = 1; i <= projection.NbPoints(); ++i) {
      const double u = projection.Parameter(i);
      if (projection.Distance(i) <= nodeTol_ && u > a + margin && u < b - margin) return true;
    }
    return false;
  }

  // --- Graph ------------------------------------------------------------------------------------

  /** Removes edges at nodes of degree 1 until there are none; returns the surviving edges. */
  [[nodiscard]] std::vector<int> prune() const {
    std::vector<int> degree(nodes_.size(), 0);
    for (const Edge& e : edges_) {
      ++degree[static_cast<std::size_t>(e.from)];
      ++degree[static_cast<std::size_t>(e.to)];
    }
    std::vector<bool> alive(edges_.size(), true);
    bool changed = true;
    while (changed) {
      changed = false;
      for (std::size_t i = 0; i < edges_.size(); ++i) {
        if (!alive[i]) continue;
        const Edge& e = edges_[i];
        int& from = degree[static_cast<std::size_t>(e.from)];
        int& to = degree[static_cast<std::size_t>(e.to)];
        if (from == 1 || to == 1) {
          alive[i] = false;
          --from;
          --to;
          changed = true;
        }
      }
    }
    std::vector<int> result;
    for (std::size_t i = 0; i < edges_.size(); ++i) {
      if (alive[i]) result.push_back(static_cast<int>(i));
    }
    return result;
  }

  /** Connected component of every node (union-find over the edges). */
  [[nodiscard]] std::vector<int> components(const std::vector<int>& alive) const {
    std::vector<int> parent(nodes_.size());
    for (std::size_t i = 0; i < parent.size(); ++i) parent[i] = static_cast<int>(i);
    const auto find = [&parent](int i) {
      int root = i;
      while (parent[static_cast<std::size_t>(root)] != root)
        root = parent[static_cast<std::size_t>(root)];
      return root;
    };
    for (const int index : alive) {
      const Edge& e = edges_[static_cast<std::size_t>(index)];
      parent[static_cast<std::size_t>(find(e.from))] = find(e.to);
    }
    std::vector<int> component(parent.size());
    for (std::size_t i = 0; i < parent.size(); ++i) component[i] = find(static_cast<int>(i));
    return component;
  }

  /**
   * Forward (from → to) and reverse half-edges of an edge: the tangent leaving the node and the
   * signed curvature κ = (x'y'' − y'x'') / |r'|³ at the end; reversing flips both.
   */
  [[nodiscard]] std::pair<HalfEdge, HalfEdge> halfEdges(int index) const {
    const Edge& e = edges_[static_cast<std::size_t>(index)];
    const double a = e.g->FirstParameter();
    const double b = e.g->LastParameter();
    const Leaving start = leaving(e.g, a, b - a);
    const Leaving end = leaving(e.g, b, a - b);
    return {{index, true, e.from, e.to, start.angle, start.curvature},
            {index, false, e.to, e.from, end.angle, end.curvature}};
  }

  /**
   * Direction and signed curvature of the curve leaving its end at parameter `u` towards the
   * inside of its range (`inward` is the signed length of the range seen from that end). Where
   * the first derivative vanishes, the chord to a point kTangentStep inside gives the direction.
   */
  static Leaving leaving(const Handle(Geom2d_Curve) & g, double u, double inward) {
    gp_Pnt2d p;
    gp_Vec2d d1;
    gp_Vec2d d2;
    g->D2(u, p, d1, d2);
    const double sign = inward > 0 ? 1 : (inward < 0 ? -1 : 0);
    const double speed = std::hypot(d1.X(), d1.Y());
    if (speed == 0) {
      gp_Pnt2d inside;
      g->D0(u + kTangentStep * inward, inside);
      return {direction(inside.X() - p.X(), inside.Y() - p.Y()), 0};
    }
    const double kappa = (d1.X() * d2.Y() - d1.Y() * d2.X()) / (speed * speed * speed);
    return {direction(sign * d1.X(), sign * d1.Y()), sign * kappa};
  }

  /**
   * All face cycles of the graph. Outgoing half-edges are sorted counter-clockwise around each
   * node by tangent angle, a tie by signed curvature (the one turning more left is further).
   * next(e) is the outgoing half-edge at e's destination right clockwise of twin(e): the face is
   * on the left. `halves` holds the forward and the reverse half-edge of each edge side by side.
   */
  [[nodiscard]] std::vector<std::vector<HalfEdge>> traceLoops(
      const std::vector<HalfEdge>& halves) const {
    std::vector<std::vector<std::size_t>> outgoing(nodes_.size());
    for (std::size_t i = 0; i < halves.size(); ++i) {
      outgoing[static_cast<std::size_t>(halves[i].origin)].push_back(i);
    }
    std::vector<std::size_t> position(halves.size(), 0);
    for (std::vector<std::size_t>& list : outgoing) {
      std::stable_sort(list.begin(), list.end(), [&](std::size_t i, std::size_t j) {
        const HalfEdge& a = halves[i];
        const HalfEdge& b = halves[j];
        if (std::abs(a.angle - b.angle) > kAngleTie) return a.angle < b.angle;
        return a.curvature < b.curvature;
      });
      for (std::size_t k = 0; k < list.size(); ++k) position[list[k]] = k;
    }
    const auto next = [&](std::size_t i) {
      const std::vector<std::size_t>& list = outgoing[static_cast<std::size_t>(halves[i].dest)];
      const std::size_t k = position[i ^ 1U];
      return list[(k + list.size() - 1) % list.size()];
    };
    std::vector<bool> visited(halves.size(), false);
    std::vector<std::vector<HalfEdge>> cycles;
    for (std::size_t start = 0; start < halves.size(); ++start) {
      if (visited[start]) continue;
      std::vector<HalfEdge> cycle;
      std::size_t i = start;
      // Every half-edge is on exactly one cycle; the bound only guards against a broken order.
      for (std::size_t steps = 0; steps <= halves.size() && !visited[i]; ++steps) {
        visited[i] = true;
        cycle.push_back(halves[i]);
        i = next(i);
      }
      cycles.push_back(std::move(cycle));
    }
    return cycles;
  }

  // --- Containment ------------------------------------------------------------------------------

  /** A point of a boundary loop: its first node, or the rightmost point of a lone circle. */
  [[nodiscard]] Vec2 samplePoint(const Loop& loop) const {
    if (loop.circle != nullptr) {
      const Curve2& c = loop.circle->curve;
      return {c.center[0] + c.radius, c.center[1]};
    }
    return nodes_[static_cast<std::size_t>(loop.halves.front().origin)];
  }

  /**
   * Whether `q` lies inside the face loop (q is never on it: crossings are excluded). A circle
   * by its radius; otherwise the parity of the hits of a ray from q. A ray through a node, along
   * a curve or grazing one is degenerate; the next direction is tried then.
   */
  [[nodiscard]] bool contains(const Loop& face, Vec2 q) const {
    if (face.circle != nullptr)
      return dist(face.circle->curve.center, q) < face.circle->curve.radius;
    if (!inBox(face.box, q)) return false;
    int hits = 0;
    for (int attempt = 0; attempt < kRayAttempts; ++attempt) {
      const double angle = kRayAngle + attempt * kGoldenAngle;
      const Vec2 far{q[0] + std::cos(angle) * rayLength_, q[1] + std::sin(angle) * rayLength_};
      bool clean = true;
      hits = rayHits(face, q, far, clean);
      if (clean) break;
    }
    return hits % 2 == 1;
  }

  /** Hits of the ray segment q → far with the loop's curves; `clean` = none is degenerate. */
  int rayHits(const Loop& face, Vec2 q, Vec2 far, bool& clean) const {
    const double dx = far[0] - q[0];
    const double dy = far[1] - q[1];
    const double length = std::hypot(dx, dy);
    const GC_MakeSegment2d maker(gp_Pnt2d(q[0], q[1]), gp_Pnt2d(far[0], far[1]));
    const Handle(Geom2d_Curve) ray(maker.Value());
    int hits = 0;
    for (const HalfEdge& h : face.halves) {
      const Edge& e = edgeOf(h);
      if (!segmentMeetsBox(q, far, e.box)) continue;
      const Geom2dAPI_InterCurveCurve inter(ray, e.g, tol_);
      if (inter.NbSegments() > 0) {
        clean = false;
        return hits;
      }
      const Vec2 ends[2] = {nodes_[static_cast<std::size_t>(e.from)],
                            nodes_[static_cast<std::size_t>(e.to)]};
      for (int i = 1; i <= inter.NbPoints(); ++i) {
        const gp_Pnt2d point = inter.Point(i);
        const Vec2 hit{point.X(), point.Y()};
        if (dist(ends[0], hit) <= nodeTol_ || dist(ends[1], hit) <= nodeTol_ ||
            grazes(e.g, point, dx / length, dy / length)) {
          clean = false;
          return hits;
        }
        ++hits;
      }
    }
    clean = true;
    return hits;
  }

  /** Whether the curve's tangent at its point nearest to `point` is (nearly) parallel to dir. */
  static bool grazes(const Handle(Geom2d_Curve) & g, const gp_Pnt2d& point, double dirX,
                     double dirY) {
    const Geom2dAPI_ProjectPointOnCurve projection(point, g);
    if (projection.NbPoints() == 0) return false;
    gp_Pnt2d p;
    gp_Vec2d v;
    g->D1(projection.LowerDistanceParameter(), p, v);
    const double speed = std::hypot(v.X(), v.Y());
    if (speed == 0) return true;
    return std::abs(dirX * v.Y() - dirY * v.X()) <= kGrazingSine * speed;
  }

  // --- Result -----------------------------------------------------------------------------------

  void addIds(const Loop& loop, std::set<std::string>& ids) const {
    if (loop.circle != nullptr) {
      ids.insert(loop.circle->curve.id);
      return;
    }
    for (const HalfEdge& h : loop.halves) ids.insert(edgeOf(h).curve.id);
  }

  /**
   * The input curves of a loop, each oriented along it: a forward half-edge is the curve as it
   * is (an arc counter-clockwise), a reverse one the same curve backwards.
   */
  [[nodiscard]] ProfileLoop curvesOf(const Loop& loop) const {
    if (loop.circle != nullptr) return {loop.circle->curve};
    ProfileLoop curves;
    for (const HalfEdge& h : loop.halves) {
      curves.push_back(h.forward ? edgeOf(h).curve : reversed(edgeOf(h).curve));
    }
    return curves;
  }

  double tol_ = 0;
  double nodeTol_ = 0;
  /** Length of a containment ray: from any point of the curves out of all of them. */
  double rayLength_ = 0;
  std::vector<Vec2> nodes_;
  std::vector<Edge> edges_;
  std::vector<LoneCircle> circles_;
};

}  // namespace

ProfileRegions profileRegionsOf(std::span<const ProfileCurve> curves) {
  auto parsed = parseProfileRegionsInput(std::vector<ProfileCurve>(curves.begin(), curves.end()));
  if (!parsed) {
    std::string text = "profileRegions:";
    for (std::size_t i = 0; i < parsed.error().size(); ++i) {
      text += (i == 0 ? " " : "; ") + parsed.error()[i];
    }
    fail(KernelErrorCode::InvalidInput, text);
  }
  return RegionFinder(*parsed).find();
}

}  // namespace tinycad::kernel::detail
