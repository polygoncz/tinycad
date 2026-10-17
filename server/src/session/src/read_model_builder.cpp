// Stub of M45 task 1; implemented by task 2. Until the tasks merge, task 3 needs a read model
// that succeeds, so build() fills only the scalar parts the runtime document tests read
// (document id, name and last_seq, the generation, the session view) and no features, bodies or
// meshes. Task 2's implementation replaces this file when the tasks merge.
#include "tinycad/session/read_model_builder.hpp"

#include "not_implemented.hpp"

namespace tinycad::session {

MeshCache::MeshCache(kernel::MeshOps& kernel) : kernel_(kernel) {}

kernel::KernelResult<std::shared_ptr<const kernel::MeshData>> MeshCache::mesh(
    const std::string& /*contentVersion*/, kernel::ShapeHandle /*shape*/,
    const kernel::MeshQuality& /*q*/) {
  throwNotImplemented("MeshCache::mesh");
}

void MeshCache::retain(const std::set<std::string>& /*live*/) {}

ReadModelBuilder::ReadModelBuilder(MeshCache& meshes) : meshes_(meshes) {}

SessionResult<void> ReadModelBuilder::build(const ReadModelInput& input,
                                            const tinycad::v1::ReadModelOptions& /*options*/,
                                            tinycad::v1::ReadModel* out) {
  out->Clear();
  auto* document = out->mutable_document();
  document->set_document_id(input.document.meta().id.str());
  document->set_name(input.document.meta().name);
  document->set_last_seq(static_cast<std::uint64_t>(input.lastSeq));
  out->mutable_regen()->set_generation(input.generation);
  auto* session = out->mutable_session();
  session->set_writable(input.writable);
  session->set_can_undo(input.canUndo);
  session->set_can_redo(input.canRedo);
  if (input.transactionLabel) session->mutable_transaction()->set_label(*input.transactionLabel);
  return {};
}

std::set<std::string> ReadModelBuilder::liveVersions(const regen::RegenResult& /*result*/,
                                                     const regen::Regenerator& /*versions*/) {
  return {};
}

}  // namespace tinycad::session
