#include "shared-cases/support/mesh_volume.hpp"

#include <cstddef>

namespace tinycad::testing {

double meshVolume(const kernel::MeshData& mesh) {
  const auto p = [&](std::uint32_t i, std::size_t axis) {
    return static_cast<double>(mesh.positions[3 * static_cast<std::size_t>(i) + axis]);
  };
  double sum = 0;
  for (std::size_t t = 0; t + 2 < mesh.indices.size(); t += 3) {
    const std::uint32_t a = mesh.indices[t];
    const std::uint32_t b = mesh.indices[t + 1];
    const std::uint32_t c = mesh.indices[t + 2];
    sum += p(a, 0) * (p(b, 1) * p(c, 2) - p(b, 2) * p(c, 1)) +
           p(a, 1) * (p(b, 2) * p(c, 0) - p(b, 0) * p(c, 2)) +
           p(a, 2) * (p(b, 0) * p(c, 1) - p(b, 1) * p(c, 0));
  }
  return sum / 6;
}

}  // namespace tinycad::testing
