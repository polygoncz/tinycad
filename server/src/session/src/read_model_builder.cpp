#include "tinycad/session/read_model_builder.hpp"

#include <array>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "struct_json.hpp"
#include "tinycad/core/curve2.hpp"
#include "tinycad/regen/face_plane.hpp"
#include "tinycad/regen/names.hpp"
#include "tinycad/session/operation_codec.hpp"

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

// ---- small values ------------------------------------------------------------------------------

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

void vec3ToProto(const core::Vec3& v, v1::Vec3* out) {
  out->set_x(v[0]);
  out->set_y(v[1]);
  out->set_z(v[2]);
}

void vec2ToProto(const core::Vec2& v, v1::Vec2* out) {
  out->set_x(v[0]);
  out->set_y(v[1]);
}

void planeToProto(const core::Plane& plane, v1::Plane* out) {
  vec3ToProto(plane.origin, out->mutable_origin());
  vec3ToProto(plane.xDir, out->mutable_x_dir());
  vec3ToProto(plane.normal, out->mutable_normal());
}

/** The same mapping as toProto of tinycad_service (internal there). */
void curveToProto(const core::Curve2& curve, v1::Curve2* out) {
  out->set_id(curve.id);
  switch (curve.kind) {
    case core::Curve2::Kind::Line: {
      auto* line = out->mutable_line();
      vec2ToProto(curve.from, line->mutable_from());
      vec2ToProto(curve.to, line->mutable_to());
      break;
    }
    case core::Curve2::Kind::Arc: {
      auto* arc = out->mutable_arc();
      vec2ToProto(curve.center, arc->mutable_center());
      vec2ToProto(curve.from, arc->mutable_from());
      vec2ToProto(curve.to, arc->mutable_to());
      arc->set_ccw(curve.ccw);
      break;
    }
    case core::Curve2::Kind::Circle: {
      auto* circle = out->mutable_circle();
      vec2ToProto(curve.center, circle->mutable_center());
      circle->set_radius(curve.radius);
      break;
    }
    case core::Curve2::Kind::BSpline: {
      auto* spline = out->mutable_bspline();
      spline->set_degree(static_cast<std::uint32_t>(curve.degree));
      for (const auto& p : curve.poles) vec2ToProto(p, spline->add_poles());
      for (double k : curve.knots) spline->add_knots(k);
      break;
    }
  }
}

/** ParamIssue.params (an object of strings and numbers) → ParamIssue.values, as toStatus does. */
void issueToProto(const document::ParamIssue& issue, v1::ParamIssue* out) {
  out->set_param(issue.param);
  out->set_code(issue.code);
  if (!issue.params.is_object()) return;
  auto& values = *out->mutable_values();
  for (const auto& item : issue.params.items()) {
    v1::ParamIssueValue& value = values[item.key()];
    if (item.value().is_number()) {
      value.set_number(item.value().get<double>());
    } else if (item.value().is_string()) {
      value.set_text(item.value().get<std::string>());
    } else {
      value.set_text(item.value().dump());
    }
  }
}

// ---- meshes on the wire ----------------------------------------------------------------------

/** Appends a 32-bit word little-endian, whatever the byte order of the server. */
void appendWord(std::string& bytes, std::uint32_t word) {
  for (int shift = 0; shift < 32; shift += 8) {
    bytes.push_back(static_cast<char>((word >> shift) & 0xFFU));
  }
}

std::string wordsOf(std::span<const std::uint32_t> values) {
  std::string bytes;
  bytes.reserve(values.size() * 4);
  for (std::uint32_t v : values) appendWord(bytes, v);
  return bytes;
}

std::string wordsOf(std::span<const float> values) {
  std::string bytes;
  bytes.reserve(values.size() * 4);
  for (float v : values) appendWord(bytes, std::bit_cast<std::uint32_t>(v));
  return bytes;
}

void meshToProto(const kernel::MeshData& mesh, v1::Mesh* out) {
  out->set_positions(wordsOf(std::span<const float>(mesh.positions)));
  out->set_normals(wordsOf(std::span<const float>(mesh.normals)));
  out->set_indices(wordsOf(std::span<const std::uint32_t>(mesh.indices)));
  out->set_face_ranges(wordsOf(std::span<const std::uint32_t>(mesh.faceRanges)));
  out->set_edge_positions(wordsOf(std::span<const float>(mesh.edgePositions)));
  out->set_edge_ranges(wordsOf(std::span<const std::uint32_t>(mesh.edgeRanges)));
}

// ---- document --------------------------------------------------------------------------------

v1::BodyMaterial materialToProto(const std::optional<document::BodyMaterial>& material) {
  if (!material) return v1::BODY_MATERIAL_UNSPECIFIED;
  switch (*material) {
    case document::BodyMaterial::Plastic:
      return v1::BODY_MATERIAL_PLASTIC;
    case document::BodyMaterial::Aluminium:
      return v1::BODY_MATERIAL_ALUMINIUM;
    case document::BodyMaterial::Steel:
      return v1::BODY_MATERIAL_STEEL;
    case document::BodyMaterial::Brass:
      return v1::BODY_MATERIAL_BRASS;
    case document::BodyMaterial::Glass:
      return v1::BODY_MATERIAL_GLASS;
    case document::BodyMaterial::Rubber:
      return v1::BODY_MATERIAL_RUBBER;
  }
  return v1::BODY_MATERIAL_UNSPECIFIED;
}

void documentToProto(const ReadModelInput& input, v1::DocumentView* out) {
  const document::DocumentMeta& meta = input.document.meta();
  const document::StudioPtr studio = input.document.studio();
  out->set_document_id(meta.id.str());
  out->set_name(meta.name);
  out->set_last_seq(static_cast<std::uint64_t>(input.lastSeq));
  out->set_created_at_ms(static_cast<std::int64_t>(std::llround(meta.createdAt)));
  for (const auto& feature : studio->features) featureToProto(*feature, out->add_features());
  out->set_rollback_index(static_cast<std::uint32_t>(studio->rollbackIndex));
  auto& bodyMeta = *out->mutable_body_meta();
  for (const auto& [id, m] : studio->bodies) {
    v1::BodyMeta& view = bodyMeta[id.str()];
    if (m.name) view.set_name(*m.name);
    view.set_hidden(m.hidden);
    if (m.color) view.set_color(*m.color);
    view.set_material(materialToProto(m.material));
  }
}

// ---- regeneration ----------------------------------------------------------------------------

v1::FeatureError::Code errorCodeToProto(regen::FeatureErrorCode code) {
  switch (code) {
    case regen::FeatureErrorCode::InvalidParams:
      return v1::FeatureError::CODE_INVALID_PARAMS;
    case regen::FeatureErrorCode::UnresolvedReference:
      return v1::FeatureError::CODE_UNRESOLVED_REFERENCE;
    case regen::FeatureErrorCode::Kernel:
      return v1::FeatureError::CODE_KERNEL;
    case regen::FeatureErrorCode::UnknownType:
      return v1::FeatureError::CODE_UNKNOWN_TYPE;
    case regen::FeatureErrorCode::StaleVersion:
      return v1::FeatureError::CODE_STALE_VERSION;
  }
  return v1::FeatureError::CODE_UNSPECIFIED;
}

void statusToProto(const regen::FeatureStatus& status, v1::FeatureStatus* out) {
  switch (status.kind) {
    case regen::FeatureStatusKind::Ok:
      out->mutable_ok();
      return;
    case regen::FeatureStatusKind::Warning:
      out->mutable_warning()->set_message(status.message);
      return;
    case regen::FeatureStatusKind::Error: {
      auto* error = out->mutable_error();
      TINYCAD_ASSERT(status.error.has_value(), "an error status without its error");
      error->set_code(errorCodeToProto(status.error->code));
      error->set_message(status.error->message);
      for (const auto& issue : status.error->issues) issueToProto(issue, error->add_issues());
      return;
    }
    case regen::FeatureStatusKind::Suppressed:
      out->mutable_suppressed();
      return;
    case regen::FeatureStatusKind::RolledBack:
      out->mutable_rolled_back();
      return;
  }
}

void anchorsToProto(const regen::FeatureAnchors& anchors, v1::FeatureAnchors* out) {
  auto& views = *out->mutable_anchors();
  for (const auto& [name, anchor] : anchors) {
    v1::Anchor& view = views[name];
    vec3ToProto(anchor.point, view.mutable_point());
    if (anchor.direction) vec3ToProto(*anchor.direction, view.mutable_direction());
  }
}

void sketchToProto(const regen::SketchArtifact& sketch, v1::SketchView* out) {
  out->set_sketch_id(sketch.id());
  out->set_feature_id(sketch.owner().str());
  planeToProto(sketch.plane, out->mutable_plane());
  // entities followed by derivedEntities, one list (spec 14 "Skici").
  core::Json entities = core::Json::array();
  for (const auto* list : {sketch.entities.get(), sketch.derivedEntities.get()}) {
    if (list == nullptr) continue;
    for (const auto& entity : *list) entities.push_back(entity);
  }
  listOfJson(entities, out->mutable_entities());
  for (const auto& region : sketch.outlines) {
    v1::RegionView* view = out->add_regions();
    view->set_name(region.name);
    for (const auto& curve : region.outer) curveToProto(curve, view->add_outer());
    for (const auto& hole : region.holes) {
      v1::Loop* loop = view->add_holes();
      for (const auto& curve : hole) curveToProto(curve, loop->add_curves());
    }
    view->set_area(region.area);
  }
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

/** One state of the read model; the meshes through the cache. Internal of build(). */
class StateWriter {
 public:
  StateWriter(MeshCache& meshes, const ReadModelInput& input,
              const v1::ReadModelOptions& options)
      : meshes_(meshes), input_(input) {
    known_.insert(options.known_meshes().begin(), options.known_meshes().end());
  }

  SessionResult<void> write(const regen::RegenState& state, v1::StateView* out) {
    for (const auto& body : state.bodies()) {
      if (auto r = writeBody(*body, out->add_bodies()); !r) return r;
    }
    for (const auto& sketch : state.sketches()) sketchToProto(*sketch, out->add_sketches());
    for (const auto& plane : state.planes()) {
      v1::PlaneView* view = out->add_planes();
      view->set_plane_id(plane->id());
      view->set_owner(plane->owner().str());
      planeToProto(plane->plane(), view->mutable_plane());
    }
    for (const auto& axis : state.axes()) {
      v1::AxisView* view = out->add_axes();
      view->set_axis_id(axis->id());
      view->set_owner(axis->owner().str());
      vec3ToProto(axis->origin(), view->mutable_origin());
      vec3ToProto(axis->direction(), view->mutable_direction());
    }
    return {};
  }

 private:
  SessionResult<void> writeBody(const regen::Body& body, v1::BodyView* out) {
    const std::string version = input_.versions.contentVersion(body);
    out->set_body_id(body.id());
    out->set_origin(body.origin().str());
    out->set_last_modified_by(body.lastModifiedBy().str());
    out->set_content_version(version);
    const regen::NameTable& names = *body.names();
    const kernel::TopologySummary& topology = names.topology();
    for (std::size_t i = 0; i < topology.faces.size(); ++i) {
      const auto name = names.nameOfFace(static_cast<int>(i));
      out->add_face_names(name ? name->str() : std::string());
      if (const auto& face = topology.faces[i].plane) {
        planeToProto(regen::sketchPlaneOfFace(*face),
                     &(*out->mutable_face_planes())[static_cast<std::uint32_t>(i)]);
      }
    }
    for (std::size_t i = 0; i < topology.edges.size(); ++i) {
      const auto name = names.nameOfEdge(static_cast<int>(i));
      out->add_edge_names(name ? name->str() : std::string());
    }
    if (known_.contains(version)) return {};
    auto mesh = meshes_.mesh(version, body.shape(), input_.quality);
    if (!mesh) {
      return core::fail(SessionError{ErrorReason::Internal, {}, {},
                                     "the mesh of body '" + body.id() + "' (" + version +
                                         ") failed: " + mesh.error().message});
    }
    meshToProto(**mesh, out->mutable_mesh());
    return {};
  }

  MeshCache& meshes_;
  const ReadModelInput& input_;
  std::set<std::string> known_;
};

}  // namespace

SessionResult<void> ReadModelBuilder::build(const ReadModelInput& input,
                                            const tinycad::v1::ReadModelOptions& options,
                                            tinycad::v1::ReadModel* out) {
  out->Clear();
  documentToProto(input, out->mutable_document());

  const regen::RegenResult& result = input.regen;
  v1::RegenView* regen = out->mutable_regen();
  regen->set_generation(input.generation);
  auto& statuses = *regen->mutable_statuses();
  for (const auto& [id, status] : result.statuses) statusToProto(status, &statuses[id.str()]);
  auto& anchors = *regen->mutable_anchors();
  for (const auto& [id, featureAnchors] : result.anchors) {
    anchorsToProto(featureAnchors, &anchors[id.str()]);
  }
  regen->set_duration_ms(result.durationMs);

  StateWriter states(meshes_, input, options);
  TINYCAD_ASSERT(result.finalState != nullptr, "a regeneration result without its final state");
  if (auto r = states.write(*result.finalState, regen->mutable_final()); !r) return r;
  if (!options.input_of().empty() && result.input &&
      result.input->feature.str() == options.input_of()) {
    v1::InputView* view = regen->mutable_input();
    view->set_feature_id(result.input->feature.str());
    if (auto r = states.write(*result.input->state, view->mutable_state()); !r) return r;
  }

  v1::SessionView* session = out->mutable_session();
  session->set_writable(input.writable);
  session->set_can_undo(input.canUndo);
  session->set_can_redo(input.canRedo);
  if (input.transactionLabel) session->mutable_transaction()->set_label(*input.transactionLabel);
  return {};
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
