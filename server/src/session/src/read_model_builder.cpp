// Stub of M45 task 1; implemented by task 2.
#include "tinycad/session/read_model_builder.hpp"

#include "not_implemented.hpp"

namespace tinycad::session {

MeshCache::MeshCache(kernel::MeshOps& kernel) : kernel_(kernel) {}

kernel::KernelResult<std::shared_ptr<const kernel::MeshData>> MeshCache::mesh(
    const std::string& /*contentVersion*/, kernel::ShapeHandle /*shape*/,
    const kernel::MeshQuality& /*q*/) {
  throwNotImplemented("MeshCache::mesh");
}

void MeshCache::retain(const std::set<std::string>& /*live*/) {
  throwNotImplemented("MeshCache::retain");
}

ReadModelBuilder::ReadModelBuilder(MeshCache& meshes) : meshes_(meshes) {}

SessionResult<void> ReadModelBuilder::build(const ReadModelInput& /*input*/,
                                            const tinycad::v1::ReadModelOptions& /*options*/,
                                            tinycad::v1::ReadModel* /*out*/) {
  return core::fail(notImplemented("ReadModelBuilder::build"));
}

std::set<std::string> ReadModelBuilder::liveVersions(const regen::RegenResult& /*result*/,
                                                     const regen::Regenerator& /*versions*/) {
  throwNotImplemented("ReadModelBuilder::liveVersions");
}

}  // namespace tinycad::session
