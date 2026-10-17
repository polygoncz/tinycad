#include "tinycad/rpc/read_model_proto.hpp"

#include <bit>
#include <cmath>
#include <cstdint>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "convert.hpp"
#include "struct_json.hpp"
#include "tinycad/core/curve2.hpp"
#include "tinycad/regen/face_plane.hpp"
#include "tinycad/regen/names.hpp"
#include "tinycad/rpc/operation_codec.hpp"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using session::BodyView;
using session::ChangeResult;
using session::HistoryView;
using session::ReadModel;
using session::ReadModelOptions;
using session::SessionEvent;

namespace {

// ---- small values ------------------------------------------------------------------------------

void vec3ToProto(const core::Vec3& v, v1::Vec3* out) {
  out->set_x(v[0]);
  out->set_y(v[1]);
  out->set_z(v[2]);
}

void planeToProto(const core::Plane& plane, v1::Plane* out) {
  vec3ToProto(plane.origin, out->mutable_origin());
  vec3ToProto(plane.xDir, out->mutable_x_dir());
  vec3ToProto(plane.normal, out->mutable_normal());
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

void documentToProto(const ReadModel& model, v1::DocumentView* out) {
  const document::DocumentMeta& meta = model.meta;
  const document::StudioPtr& studio = model.studio;
  out->set_document_id(meta.id.str());
  out->set_name(meta.name);
  out->set_last_seq(static_cast<std::uint64_t>(model.lastSeq));
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
    for (const auto& curve : region.outer) toProto(curve, *view->add_outer());
    for (const auto& hole : region.holes) {
      v1::Loop* loop = view->add_holes();
      for (const auto& curve : hole) toProto(curve, *loop->add_curves());
    }
    view->set_area(region.area);
  }
}

// ---- states ----------------------------------------------------------------------------------

void bodyToProto(const BodyView& view, v1::BodyView* out) {
  const regen::Body& body = *view.body;
  out->set_body_id(body.id());
  out->set_origin(body.origin().str());
  out->set_last_modified_by(body.lastModifiedBy().str());
  out->set_content_version(view.contentVersion);
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
  if (view.mesh) meshToProto(*view.mesh, out->mutable_mesh());
}

/** One state: `bodies` are the views of state.bodies(), in the same order. */
void stateToProto(const regen::RegenState& state, const std::vector<BodyView>& bodies,
                  v1::StateView* out) {
  for (const BodyView& body : bodies) bodyToProto(body, out->add_bodies());
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
}

}  // namespace

void readModelToProto(const ReadModel& model, v1::ReadModel* out) {
  out->Clear();
  documentToProto(model, out->mutable_document());

  const regen::RegenResult& result = model.regen;
  v1::RegenView* regen = out->mutable_regen();
  regen->set_generation(model.generation);
  auto& statuses = *regen->mutable_statuses();
  for (const auto& [id, status] : result.statuses) statusToProto(status, &statuses[id.str()]);
  auto& anchors = *regen->mutable_anchors();
  for (const auto& [id, featureAnchors] : result.anchors) {
    anchorsToProto(featureAnchors, &anchors[id.str()]);
  }
  regen->set_duration_ms(result.durationMs);

  TINYCAD_ASSERT(result.finalState != nullptr, "a regeneration result without its final state");
  stateToProto(*result.finalState, model.bodies, regen->mutable_final());
  if (result.input) {
    v1::InputView* view = regen->mutable_input();
    view->set_feature_id(result.input->feature.str());
    stateToProto(*result.input->state, model.inputBodies, view->mutable_state());
  }

  v1::SessionView* session = out->mutable_session();
  session->set_writable(model.session.writable);
  session->set_can_undo(model.session.canUndo);
  session->set_can_redo(model.session.canRedo);
  if (model.session.transactionLabel) {
    session->mutable_transaction()->set_label(*model.session.transactionLabel);
  }
}

void changeResultToProto(const ChangeResult& change, v1::ChangeResult* out) {
  out->Clear();
  if (change.entry) logEntryView(*change.entry, out->mutable_entry());
  readModelToProto(change.readModel, out->mutable_read_model());
}

void historyToProto(const HistoryView& history, v1::GetHistoryResponse* out) {
  out->Clear();
  for (const core::Json& entry : history.entries) logEntryView(entry, out->add_entries());
  for (const std::int64_t seq : history.undoStack) {
    out->add_undo_stack(static_cast<std::uint64_t>(seq));
  }
  for (const std::int64_t seq : history.redoStack) {
    out->add_redo_stack(static_cast<std::uint64_t>(seq));
  }
}

void sessionEventToProto(const SessionEvent& event, v1::SessionEvent* out) {
  out->Clear();
  out->set_seq(event.seq);
  switch (event.kind) {
    case SessionEvent::Kind::Changed: {
      auto* changed = out->mutable_changed();
      changed->set_generation(event.generation);
      changed->set_last_seq(static_cast<std::uint64_t>(event.lastSeq));
      changed->set_by_session_id(event.bySessionId);
      return;
    }
    case SessionEvent::Kind::RegenProgress: {
      auto* progress = out->mutable_regen_progress();
      progress->set_generation(event.generation);
      progress->set_feature_id(event.featureId.str());
      statusToProto(event.status, progress->mutable_status());
      return;
    }
  }
}

ReadModelOptions readModelOptionsOf(const v1::ReadModelOptions& options) {
  ReadModelOptions out;
  out.knownMeshes.insert(options.known_meshes().begin(), options.known_meshes().end());
  if (!options.input_of().empty()) out.inputOf = document::FeatureId(options.input_of());
  return out;
}

}  // namespace tinycad::rpc
