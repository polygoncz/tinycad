#include "tinycad/rpc/operation_codec.hpp"

#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>

#include "struct_json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using session::ErrorReason;
using session::SessionError;
using session::SessionResult;
using core::Json;

namespace {

SessionError invalid(std::string path, std::string message) {
  return {ErrorReason::InvalidOperation, std::move(path), {}, std::move(message)};
}

/** { type, v } of the current version of the type (OP_VERSION). */
Json header(const std::string& type) { return Json{{"type", type}, {"v", ops::opVersion(type)}}; }

Json featureJson(const v1::FeatureInstance& feature) {
  return Json{{"id", feature.id()},
              {"type", feature.type()},
              {"typeVersion", feature.type_version()},
              {"name", feature.name()},
              {"suppressed", feature.suppressed()},
              {"params", jsonOfStruct(feature.params())}};
}

/** BodyMaterial enum → its JSON name; UNSPECIFIED (and unknown numbers) → nullopt. */
std::optional<std::string> materialName(v1::BodyMaterial material) {
  switch (material) {
    case v1::BODY_MATERIAL_PLASTIC:
      return "plastic";
    case v1::BODY_MATERIAL_ALUMINIUM:
      return "aluminium";
    case v1::BODY_MATERIAL_STEEL:
      return "steel";
    case v1::BODY_MATERIAL_BRASS:
      return "brass";
    case v1::BODY_MATERIAL_GLASS:
      return "glass";
    case v1::BODY_MATERIAL_RUBBER:
      return "rubber";
    default:
      return std::nullopt;
  }
}

v1::BodyMaterial materialOf(const std::string& name) {
  if (name == "plastic") return v1::BODY_MATERIAL_PLASTIC;
  if (name == "aluminium") return v1::BODY_MATERIAL_ALUMINIUM;
  if (name == "steel") return v1::BODY_MATERIAL_STEEL;
  if (name == "brass") return v1::BODY_MATERIAL_BRASS;
  if (name == "glass") return v1::BODY_MATERIAL_GLASS;
  if (name == "rubber") return v1::BODY_MATERIAL_RUBBER;
  TINYCAD_ASSERT(false, "unknown body material '" + name + "'");
  return v1::BODY_MATERIAL_UNSPECIFIED;
}

/** `path` names `op` in proto field names: 'op' at the top, 'op.batch.ops[2]' inside a batch. */
SessionResult<Json> toJson(const v1::Operation& op, const std::string& path) {
  switch (op.op_case()) {
    case v1::Operation::kFeatureAdd: {
      Json out = header("feature.add");
      out["feature"] = featureJson(op.feature_add().feature());
      out["index"] = op.feature_add().index();
      return out;
    }
    case v1::Operation::kFeatureRemove: {
      Json out = header("feature.remove");
      out["featureId"] = op.feature_remove().feature_id();
      return out;
    }
    case v1::Operation::kFeatureSetParams: {
      const auto& m = op.feature_set_params();
      Json out = header("feature.setParams");
      out["featureId"] = m.feature_id();
      out["typeVersion"] = m.type_version();
      out["params"] = jsonOfStruct(m.params());
      return out;
    }
    case v1::Operation::kFeatureRename: {
      Json out = header("feature.rename");
      out["featureId"] = op.feature_rename().feature_id();
      out["name"] = op.feature_rename().name();
      return out;
    }
    case v1::Operation::kFeatureSuppress: {
      Json out = header("feature.suppress");
      out["featureId"] = op.feature_suppress().feature_id();
      out["suppressed"] = op.feature_suppress().suppressed();
      return out;
    }
    case v1::Operation::kFeatureMove: {
      Json out = header("feature.move");
      out["featureId"] = op.feature_move().feature_id();
      out["toIndex"] = op.feature_move().to_index();
      return out;
    }
    case v1::Operation::kStudioSetRollback: {
      Json out = header("studio.setRollback");
      out["index"] = op.studio_set_rollback().index();
      return out;
    }
    // body_id on the wire is `body` in the JSON operation of spec 04 (BodyRenameOp.body).
    case v1::Operation::kBodyRename: {
      Json out = header("body.rename");
      out["body"] = op.body_rename().body_id();
      out["name"] = op.body_rename().name();
      return out;
    }
    case v1::Operation::kBodySetVisible: {
      Json out = header("body.setVisible");
      out["body"] = op.body_set_visible().body_id();
      out["visible"] = op.body_set_visible().visible();
      return out;
    }
    case v1::Operation::kBodySetColor: {
      const auto& m = op.body_set_color();
      Json out = header("body.setColor");
      out["body"] = m.body_id();
      out["color"] = m.has_color() ? Json(m.color()) : Json(nullptr);
      return out;
    }
    case v1::Operation::kBodySetMaterial: {
      const auto& m = op.body_set_material();
      const auto name = materialName(m.material());
      if (!name) {
        return core::fail(invalid(path + ".body_set_material.material",
                                  "the material is unspecified or unknown"));
      }
      Json out = header("body.setMaterial");
      out["body"] = m.body_id();
      out["material"] = *name;
      return out;
    }
    case v1::Operation::kDocumentRename: {
      Json out = header("document.rename");
      out["name"] = op.document_rename().name();
      return out;
    }
    case v1::Operation::kBatch: {
      Json items = Json::array();
      const auto& ops = op.batch().ops();
      for (int i = 0; i < ops.size(); ++i) {
        auto item = toJson(ops.Get(i), path + ".batch.ops[" + std::to_string(i) + "]");
        if (!item) return core::fail(std::move(item.error()));
        items.push_back(std::move(*item));
      }
      Json out = header("batch");
      out["ops"] = std::move(items);
      return out;
    }
    case v1::Operation::OP_NOT_SET:
      break;
  }
  return core::fail(invalid(path, "the operation has no type (empty oneof)"));
}

std::uint32_t uintOf(const Json& value) { return value.get<std::uint32_t>(); }

void featureFromJson(const Json& json, v1::FeatureInstance* out) {
  out->set_id(json.at("id").get<std::string>());
  out->set_type(json.at("type").get<std::string>());
  out->set_type_version(uintOf(json.at("typeVersion")));
  out->set_name(json.at("name").get<std::string>());
  out->set_suppressed(json.at("suppressed").get<bool>());
  structOfJson(json.at("params"), out->mutable_params());
}

}  // namespace

SessionResult<Json> operationToJson(const v1::Operation& op) { return toJson(op, "op"); }

void operationFromJson(const Json& json, v1::Operation* out) {
  TINYCAD_ASSERT(json.is_object() && json.contains("type"), "not an operation: " + json.dump());
  const std::string type = json.at("type").get<std::string>();
  out->Clear();
  if (type == "feature.add") {
    auto* m = out->mutable_feature_add();
    featureFromJson(json.at("feature"), m->mutable_feature());
    m->set_index(uintOf(json.at("index")));
  } else if (type == "feature.remove") {
    out->mutable_feature_remove()->set_feature_id(json.at("featureId").get<std::string>());
  } else if (type == "feature.setParams") {
    auto* m = out->mutable_feature_set_params();
    m->set_feature_id(json.at("featureId").get<std::string>());
    m->set_type_version(uintOf(json.at("typeVersion")));
    structOfJson(json.at("params"), m->mutable_params());
  } else if (type == "feature.rename") {
    auto* m = out->mutable_feature_rename();
    m->set_feature_id(json.at("featureId").get<std::string>());
    m->set_name(json.at("name").get<std::string>());
  } else if (type == "feature.suppress") {
    auto* m = out->mutable_feature_suppress();
    m->set_feature_id(json.at("featureId").get<std::string>());
    m->set_suppressed(json.at("suppressed").get<bool>());
  } else if (type == "feature.move") {
    auto* m = out->mutable_feature_move();
    m->set_feature_id(json.at("featureId").get<std::string>());
    m->set_to_index(uintOf(json.at("toIndex")));
  } else if (type == "studio.setRollback") {
    out->mutable_studio_set_rollback()->set_index(uintOf(json.at("index")));
  } else if (type == "body.rename") {
    auto* m = out->mutable_body_rename();
    m->set_body_id(json.at("body").get<std::string>());
    m->set_name(json.at("name").get<std::string>());
  } else if (type == "body.setVisible") {
    auto* m = out->mutable_body_set_visible();
    m->set_body_id(json.at("body").get<std::string>());
    m->set_visible(json.at("visible").get<bool>());
  } else if (type == "body.setColor") {
    auto* m = out->mutable_body_set_color();
    m->set_body_id(json.at("body").get<std::string>());
    if (!json.at("color").is_null()) m->set_color(json.at("color").get<std::string>());
  } else if (type == "body.setMaterial") {
    auto* m = out->mutable_body_set_material();
    m->set_body_id(json.at("body").get<std::string>());
    m->set_material(materialOf(json.at("material").get<std::string>()));
  } else if (type == "document.rename") {
    out->mutable_document_rename()->set_name(json.at("name").get<std::string>());
  } else if (type == "batch") {
    auto* m = out->mutable_batch();
    for (const auto& item : json.at("ops")) operationFromJson(item, m->add_ops());
  } else {
    TINYCAD_ASSERT(false, "unknown operation type '" + type + "'");
  }
}

void featureToProto(const document::FeatureInstance& feature, v1::FeatureInstance* out) {
  out->set_id(feature.id.str());
  out->set_type(feature.type);
  out->set_type_version(static_cast<std::uint32_t>(feature.typeVersion));
  out->set_name(feature.name);
  out->set_suppressed(feature.suppressed);
  if (feature.params) {
    structOfJson(*feature.params, out->mutable_params());
  } else {
    out->mutable_params();
  }
}

void logEntryView(const Json& entry, v1::LogEntryView* out) {
  out->set_seq(entry.at("seq").get<std::uint64_t>());
  const std::string kind = entry.at("kind").get<std::string>();
  if (kind == "do") {
    out->set_kind(v1::LogEntryView::KIND_DO);
  } else if (kind == "undo") {
    out->set_kind(v1::LogEntryView::KIND_UNDO);
  } else if (kind == "redo") {
    out->set_kind(v1::LogEntryView::KIND_REDO);
  } else {
    TINYCAD_ASSERT(false, "unknown log entry kind '" + kind + "'");
  }
  out->set_target(entry.contains("target") ? entry.at("target").get<std::uint64_t>() : 0);
  out->set_label(entry.at("label").get<std::string>());
  // ms since the epoch → Timestamp; floor division keeps nanos within [0, 1e9) before 1970 too.
  const auto ms = static_cast<std::int64_t>(std::llround(entry.at("time").get<double>()));
  std::int64_t seconds = ms / 1000;
  std::int64_t rest = ms % 1000;
  if (rest < 0) {
    rest += 1000;
    seconds -= 1;
  }
  out->mutable_time()->set_seconds(seconds);
  out->mutable_time()->set_nanos(static_cast<std::int32_t>(rest * 1'000'000));
  out->set_op_type(ops::typeOf(entry.at("op")));
}

}  // namespace tinycad::rpc
