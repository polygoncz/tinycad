#include "tinycad/session/read_model_builder.hpp"

#include <array>
#include <charconv>
#include <string>
#include <utility>
#include <vector>

namespace tinycad::session {

namespace {

/** The shortest text that reads back as the same double (the key of the mesh cache). */
std::string shortest(double value) {
  std::array<char, 32> buffer{};
  const auto result = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value);
  return {buffer.data(), result.ptr};
}

/** "<content_version>@<linear>/<angular>" (N60). */
std::string meshKey(const std::string& contentVersion, const kernel::MeshQuality& q) {
  return contentVersion + "@" + shortest(q.linearDeflection) + "/" +
         shortest(q.angularDeflection);
}

}  // namespace

// =============================================================================================
// MeshCache

MeshCache::MeshCache(kernel::MeshOps& kernel) : kernel_(kernel) {}

kernel::KernelResult<std::shared_ptr<const kernel::MeshData>> MeshCache::mesh(
    const std::string& contentVersion, kernel::ShapeHandle shape, const kernel::MeshQuality& q) {
  const std::string key = meshKey(contentVersion, q);
  if (const auto it = meshes_.find(key); it != meshes_.end()) return it->second;
  auto tessellated = kernel_.tessellate(shape, q);
  if (!tessellated) return core::fail(tessellated.error());
  auto mesh = std::make_shared<const kernel::MeshData>(std::move(*tessellated));
  meshes_.emplace(key, mesh);
  return mesh;
}

void MeshCache::retain(const std::set<std::string>& live) {
  std::erase_if(meshes_, [&](const auto& entry) {
    const std::string& key = entry.first;
    return !live.contains(key.substr(0, key.rfind('@')));
  });
}

// =============================================================================================
// ReadModelBuilder

ReadModelBuilder::ReadModelBuilder(MeshCache& meshes) : meshes_(meshes) {}

namespace {

/** The bodies of one state with their versions and meshes. Internal of build(). */
class BodyViews {
 public:
  BodyViews(MeshCache& meshes, const ReadModelInput& input, const ReadModelOptions& options)
      : meshes_(meshes), input_(input), known_(options.knownMeshes) {}

  SessionResult<std::vector<BodyView>> of(const regen::RegenState& state) {
    std::vector<BodyView> views;
    for (const regen::BodyPtr& body : state.bodies()) {
      auto view = viewOf(body);
      if (!view) return core::fail(std::move(view.error()));
      views.push_back(std::move(*view));
    }
    return views;
  }

 private:
  SessionResult<BodyView> viewOf(const regen::BodyPtr& body) {
    BodyView view{body, input_.versions.contentVersion(*body), nullptr};
    if (known_.contains(view.contentVersion)) return view;
    auto mesh = meshes_.mesh(view.contentVersion, body->shape(), input_.quality);
    if (!mesh) {
      return core::fail(SessionError{ErrorReason::Internal, {}, {},
                                     "the mesh of body '" + body->id() + "' (" +
                                         view.contentVersion +
                                         ") failed: " + mesh.error().message});
    }
    view.mesh = std::move(*mesh);
    return view;
  }

  MeshCache& meshes_;
  const ReadModelInput& input_;
  const std::set<std::string>& known_;
};

}  // namespace

SessionResult<ReadModel> ReadModelBuilder::build(const ReadModelInput& input,
                                                 const ReadModelOptions& options) {
  ReadModel model;
  model.meta = input.document.meta();
  model.studio = input.document.studio();
  model.lastSeq = input.lastSeq;
  model.generation = input.generation;
  model.regen = input.regen;
  const bool inputAsked = options.inputOf && model.regen.input &&
                          model.regen.input->feature == *options.inputOf;
  if (!inputAsked) model.regen.input.reset();

  BodyViews views(meshes_, input, options);
  TINYCAD_ASSERT(model.regen.finalState != nullptr,
                 "a regeneration result without its final state");
  auto bodies = views.of(*model.regen.finalState);
  if (!bodies) return core::fail(std::move(bodies.error()));
  model.bodies = std::move(*bodies);
  if (model.regen.input) {
    auto inputBodies = views.of(*model.regen.input->state);
    if (!inputBodies) return core::fail(std::move(inputBodies.error()));
    model.inputBodies = std::move(*inputBodies);
  }

  model.session = {input.writable, input.canUndo, input.canRedo, input.transactionLabel};
  return model;
}

std::set<std::string> ReadModelBuilder::liveVersions(const regen::RegenResult& result,
                                                     const regen::Regenerator& versions) {
  std::set<std::string> live;
  if (result.finalState) {
    for (const auto& body : result.finalState->bodies()) {
      live.insert(versions.contentVersion(*body));
    }
  }
  if (result.input) {
    for (const auto& body : result.input->state->bodies()) {
      live.insert(versions.contentVersion(*body));
    }
  }
  return live;
}

}  // namespace tinycad::session
