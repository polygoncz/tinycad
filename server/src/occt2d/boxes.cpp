#include "tinycad/occt2d/boxes.hpp"

#include <algorithm>
#include <numeric>

namespace tinycad::occt2d {

Box boxOf(const Curve2& curve, double tol) {
  std::vector<Vec2> points;
  switch (curve.kind) {
    case Kind::Line:
      points = {curve.from, curve.to};
      break;
    case Kind::Arc:
    case Kind::Circle: {
      const double r = curve.kind == Kind::Arc ? dist(curve.center, curve.from) : curve.radius;
      points = {Vec2{curve.center[0] - r, curve.center[1] - r},
                Vec2{curve.center[0] + r, curve.center[1] + r}};
      break;
    }
    case Kind::BSpline:
      points = curve.poles;
      break;
  }
  Box box{points[0][0], points[0][1], points[0][0], points[0][1]};
  for (const Vec2& q : points) {
    box[0] = std::min(box[0], q[0]);
    box[1] = std::min(box[1], q[1]);
    box[2] = std::max(box[2], q[0]);
    box[3] = std::max(box[3], q[1]);
  }
  return {box[0] - tol, box[1] - tol, box[2] + tol, box[3] + tol};
}

Box unionOf(const Box& a, const Box& b) {
  return {std::min(a[0], b[0]), std::min(a[1], b[1]), std::max(a[2], b[2]), std::max(a[3], b[3])};
}

bool boxesOverlap(const Box& a, const Box& b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

bool inBox(const Box& b, Vec2 q) {
  return q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
}

std::vector<std::pair<std::size_t, std::size_t>> overlappingPairs(const std::vector<Box>& boxes) {
  std::vector<std::size_t> order(boxes.size());
  std::iota(order.begin(), order.end(), std::size_t{0});
  std::stable_sort(order.begin(), order.end(),
                   [&](std::size_t i, std::size_t j) { return boxes[i][0] < boxes[j][0]; });
  std::vector<std::pair<std::size_t, std::size_t>> pairs;
  for (std::size_t k = 0; k < order.size(); ++k) {
    const std::size_t i = order[k];
    for (std::size_t m = k + 1; m < order.size(); ++m) {
      const std::size_t j = order[m];
      if (boxes[j][0] > boxes[i][2]) break;
      if (boxesOverlap(boxes[i], boxes[j])) pairs.emplace_back(std::min(i, j), std::max(i, j));
    }
  }
  return pairs;
}

}  // namespace tinycad::occt2d
