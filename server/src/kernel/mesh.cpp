#include "tinycad/kernel/mesh.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <map>
#include <optional>
#include <string>

// Port of src/kernel/mesh.ts (validateMeshData) and src/kernel/transform.ts (isRigidMotion).

namespace tinycad::kernel {

namespace {

/** validateMeshData: tolerance of a unit normal. */
constexpr double kUnitTolerance = 1e-4;
/** isRigidMotion: element-wise tolerance (EPSILON of core). */
constexpr double kRigidTolerance = 1e-9;

/** Collects the messages of one validateMeshData call. */
class MeshReport {
 public:
  void add(const std::string& message) { messages_.push_back(message); }
  [[nodiscard]] std::vector<std::string> take() { return std::move(messages_); }

 private:
  std::vector<std::string> messages_;
};

std::string str(std::size_t n) { return std::to_string(n); }

bool checkTriples(const std::string& name, std::size_t length, MeshReport& report) {
  if (length % 3 == 0) return true;
  report.add(name + ": length " + str(length) + " is not divisible by 3");
  return false;
}

void checkFinite(const std::string& name, const std::vector<float>& values, MeshReport& report) {
  std::size_t count = 0;
  std::size_t first = 0;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (std::isfinite(values[i])) continue;
    if (count == 0) first = i;
    ++count;
  }
  if (count > 0) {
    report.add(name + "[" + str(first) + "]: not finite (" + str(count) + " non-finite values)");
  }
}

void checkUnitNormals(const std::vector<float>& normals, MeshReport& report) {
  for (std::size_t v = 0; v < normals.size() / 3; ++v) {
    const double length =
        std::hypot(static_cast<double>(normals[3 * v]), static_cast<double>(normals[3 * v + 1]),
                   static_cast<double>(normals[3 * v + 2]));
    // Non-finite normals are already reported by checkFinite.
    if (std::isfinite(length) && std::abs(length - 1) > kUnitTolerance) {
      report.add("normals: vertex " + str(v) + " has length " + std::to_string(length));
    }
  }
}

void checkVertexIndices(const std::vector<std::uint32_t>& indices, std::size_t vertexCount,
                        MeshReport& report) {
  for (std::size_t i = 0; i < indices.size(); ++i) {
    if (indices[i] >= vertexCount) {
      report.add("indices[" + str(i) + "]: vertex " + str(indices[i]) + " out of range (" +
                 str(vertexCount) + " vertices)");
    }
  }
}

struct RangeLabels {
  /** Name of the ranges array, e.g. "faceRanges". */
  std::string array;
  /** What the ranges cover, e.g. "triangles". */
  std::string item;
  /** Name of the second number of a triple, e.g. "firstTriangle". */
  std::string first;
  /** What the first number of a triple identifies, e.g. "face". */
  std::string key;
  std::uint32_t minCount;
};

/**
 * Ranges are triples [key, first, count]: unique keys, strictly increasing first, a minimal
 * count and – when the number of covered items is known – every item covered exactly once.
 */
void checkRanges(const std::vector<std::uint32_t>& ranges, std::optional<std::size_t> itemCount,
                 const RangeLabels& labels, MeshReport& report) {
  const std::size_t rangeCount = ranges.size() / 3;
  std::map<std::uint32_t, std::size_t> rangeOfKey;
  // owner[i] = the range that covered item i first, -1 = not covered yet.
  std::vector<long long> owner(itemCount.value_or(0), -1);

  for (std::size_t r = 0; r < rangeCount; ++r) {
    const std::uint32_t key = ranges[3 * r];
    const std::uint32_t first = ranges[3 * r + 1];
    const std::uint32_t count = ranges[3 * r + 2];
    const std::string at = labels.array + "[" + str(r) + "]";

    const auto [previous, inserted] = rangeOfKey.emplace(key, r);
    if (!inserted) {
      report.add(at + ": " + labels.key + " " + str(key) + " already in " + labels.array + "[" +
                 str(previous->second) + "]");
    }
    if (r > 0 && first <= ranges[3 * (r - 1) + 1]) {
      report.add(at + ": " + labels.first + " " + str(first) + " not greater than " +
                 str(ranges[3 * (r - 1) + 1]) + " in " + labels.array + "[" + str(r - 1) + "]");
    }
    if (count < labels.minCount) {
      report.add(at + ": " + str(count) + " " + labels.item + ", at least " + str(labels.minCount) +
                 " required");
    }
    if (!itemCount) continue;
    const std::size_t end = static_cast<std::size_t>(first) + count;
    if (end > *itemCount) {
      report.add(at + ": " + labels.item + " " + str(first) + ".." + str(end - 1) +
                 " out of range (" + str(*itemCount) + " " + labels.item + ")");
    }
    std::size_t i = first;
    const std::size_t to = std::min(end, *itemCount);
    while (i < to) {
      const long long other = owner[i];
      if (other < 0) {
        owner[i] = static_cast<long long>(r);
        ++i;
        continue;
      }
      const std::size_t start = i;
      while (i < to && owner[i] == other) ++i;
      report.add(labels.array + "[" + str(r) + "]: " + labels.item + " " + str(start) + ".." +
                 str(i - 1) + " overlap " + labels.key + " " +
                 str(ranges[3 * static_cast<std::size_t>(other)]));
    }
  }

  std::size_t i = 0;
  while (i < owner.size()) {
    if (owner[i] != -1) {
      ++i;
      continue;
    }
    const std::size_t start = i;
    while (i < owner.size() && owner[i] == -1) ++i;
    report.add(labels.array + ": " + labels.item + " " + str(start) + ".." + str(i - 1) +
               " not covered by any " + labels.key);
  }
}

using Column = std::array<double, 3>;

double dot(const Column& a, const Column& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

Column cross(const Column& a, const Column& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}

}  // namespace

std::vector<std::string> validateMeshData(const MeshData& mesh) {
  MeshReport report;
  const bool positionsOk = checkTriples("positions", mesh.positions.size(), report);
  const bool normalsOk = checkTriples("normals", mesh.normals.size(), report);
  if (mesh.normals.size() != mesh.positions.size()) {
    report.add("normals: length " + str(mesh.normals.size()) + " differs from positions length " +
               str(mesh.positions.size()));
  }
  const bool indicesOk = checkTriples("indices", mesh.indices.size(), report);
  const bool faceRangesOk = checkTriples("faceRanges", mesh.faceRanges.size(), report);
  const bool edgePositionsOk = checkTriples("edgePositions", mesh.edgePositions.size(), report);
  const bool edgeRangesOk = checkTriples("edgeRanges", mesh.edgeRanges.size(), report);

  checkFinite("positions", mesh.positions, report);
  checkFinite("normals", mesh.normals, report);
  checkFinite("edgePositions", mesh.edgePositions, report);
  if (normalsOk) checkUnitNormals(mesh.normals, report);
  if (positionsOk) checkVertexIndices(mesh.indices, mesh.positions.size() / 3, report);

  if (faceRangesOk) {
    const auto triangles = indicesOk ? std::optional(mesh.indices.size() / 3) : std::nullopt;
    checkRanges(mesh.faceRanges, triangles, {"faceRanges", "triangles", "firstTriangle", "face", 1},
                report);
  }
  if (edgeRangesOk) {
    const auto points =
        edgePositionsOk ? std::optional(mesh.edgePositions.size() / 3) : std::nullopt;
    checkRanges(mesh.edgeRanges, points, {"edgeRanges", "points", "firstPoint", "edge", 2}, report);
  }
  return report.take();
}

bool isRigidMotion(const core::Mat4& m) {
  for (const double v : m) {
    if (!std::isfinite(v)) return false;
  }
  const auto near = [](double a, double b) { return std::abs(a - b) <= kRigidTolerance; };
  // Column-major: element (row r, column c) is at c * 4 + r, so the bottom row is 3, 7, 11, 15.
  if (!(near(m[3], 0) && near(m[7], 0) && near(m[11], 0) && near(m[15], 1))) return false;
  const std::array<Column, 3> columns{Column{m[0], m[1], m[2]}, Column{m[4], m[5], m[6]},
                                      Column{m[8], m[9], m[10]}};
  // Orthonormal: Rᵀ·R = I, i.e. the columns are unit and pairwise perpendicular.
  for (std::size_t i = 0; i < 3; ++i) {
    for (std::size_t j = i; j < 3; ++j) {
      if (!near(dot(columns[i], columns[j]), i == j ? 1 : 0)) return false;
    }
  }
  // An orthonormal matrix has det ±1; −1 is a mirror.
  return dot(columns[0], cross(columns[1], columns[2])) > 0;
}

}  // namespace tinycad::kernel
