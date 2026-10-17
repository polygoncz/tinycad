// Planes of references (spec 07, spec 12 "Roviny a počátek", src/regen/face-plane.ts).

#include "tinycad/regen/face_plane.hpp"

#include <cmath>

#include "resolve.hpp"
#include "vec.hpp"

namespace tinycad::regen {

namespace {

/** Above this |normal · X| the projection of +X is too short; +Y is projected instead (spec 12). */
constexpr double kXParallelLimit = 0.9;

constexpr Vec3 kX{1, 0, 0};
constexpr Vec3 kY{0, 1, 0};

}  // namespace

Plane sketchPlaneOfFace(const kernel::FacePlane& face) {
  const Vec3 normal = vec::normalize(face.normal);
  const Vec3 origin = vec::scale(normal, vec::dot(face.origin, normal));
  const Vec3 towards = std::abs(vec::dot(normal, kX)) >= kXParallelLimit ? kY : kX;
  const Vec3 xDir =
      vec::normalize(vec::sub(towards, vec::scale(normal, vec::dot(towards, normal))));
  return Plane{origin, xDir, normal};
}

std::optional<Plane> planeOfRef(const RegenState& state, const document::EntityRef& ref) {
  auto resolved = detail::resolvePlaneRef(state, ref);
  if (!resolved) return std::nullopt;
  return resolved->plane;
}

namespace detail {

core::Result<NamedTopo, std::string> resolveNamed(const RegenState& state, const BodyId& id,
                                                  const TopoName& name, TopoKind kind) {
  const ArtifactPtr artifact = state.find(id.str());
  if (artifact == nullptr) return core::fail("Body '" + id.str() + "' does not exist");
  if (artifact->kind() != ArtifactKind::Body) {
    return core::fail("'" + id.str() + "' is not a body");
  }
  // static_pointer_cast is safe: the kind is Body.
  BodyPtr body = std::static_pointer_cast<const Body>(artifact);
  const auto& indices =
      kind == TopoKind::Face ? body->names()->faces(name) : body->names()->edges(name);
  if (indices.empty()) {
    return core::fail(std::string(kind == TopoKind::Face ? "Face" : "Edge") + " '" + name.str() +
                      "' not found on body '" + id.str() + "'");
  }
  return NamedTopo{std::move(body), indices};
}

core::Result<PlaneOfRef, std::string> resolvePlaneRef(const RegenState& state,
                                                      const document::EntityRef& ref) {
  if (ref.kind == document::RefKind::Plane) {
    const ArtifactPtr artifact = state.find(ref.plane.str());
    if (artifact == nullptr) return core::fail("Plane '" + ref.plane.str() + "' does not exist");
    if (artifact->kind() != ArtifactKind::Plane) {
      return core::fail("'" + ref.plane.str() + "' is not a plane");
    }
    return PlaneOfRef{artifact->as<PlaneArtifact>().plane(), 1};
  }
  if (ref.kind != document::RefKind::Topo) {
    return core::fail(std::string("A ") + std::string(document::refKindName(ref.kind)) +
                      " reference is not a plane");
  }
  auto found = resolveNamed(state, ref.body, ref.name, TopoKind::Face);
  if (!found) return core::fail(found.error());
  // indices are ascending and not empty: the first is the face with the smallest index.
  const int index = found->indices.front();
  const auto& faces = found->body->names()->topology().faces;
  const kernel::FaceInfo* face =
      static_cast<std::size_t>(index) < faces.size() ? &faces[static_cast<std::size_t>(index)]
                                                     : nullptr;
  if (face == nullptr || face->surface != kernel::SurfaceType::Plane || !face->plane) {
    return core::fail("Face '" + ref.name.str() + "' is not planar");
  }
  return PlaneOfRef{sketchPlaneOfFace(*face->plane), found->indices.size()};
}

}  // namespace detail

}  // namespace tinycad::regen
