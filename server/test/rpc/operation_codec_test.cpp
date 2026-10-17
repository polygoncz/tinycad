// tinycad.v1.Operation ↔ the JSON operation of spec 04 (spec 14 "Testy": every Operation ↔
// JSON operation and back, N27), the feature and log entry views.

#include "tinycad/rpc/operation_codec.hpp"

#include <gtest/gtest.h>
#include <google/protobuf/util/message_differencer.h>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "tinycad/ops/operation.hpp"

namespace tinycad::rpc {
namespace {

namespace v1 = tinycad::v1;
using core::Json;
using session::ErrorReason;
using google::protobuf::util::MessageDifferencer;

/** One JSON operation of each of the 13 types, with the current `v` (OP_VERSION). */
std::vector<Json> everyOperation() {
  return {
      Json::parse(R"({"type":"feature.add","v":1,"index":2,"feature":{"id":"f1","type":"box",
        "typeVersion":1,"name":"Box 1","suppressed":false,
        "params":{"width":10,"depth":2.5,"origin":[0,0,1],"note":null,"flag":true}}})"),
      Json::parse(R"({"type":"feature.remove","v":1,"featureId":"f1"})"),
      Json::parse(R"({"type":"feature.setParams","v":2,"featureId":"f1","typeVersion":3,
        "params":{"width":2,"nested":{"a":[1,"x",{"b":false}]}}})"),
      Json::parse(R"({"type":"feature.rename","v":1,"featureId":"f1","name":"Base"})"),
      Json::parse(R"({"type":"feature.suppress","v":1,"featureId":"f1","suppressed":true})"),
      Json::parse(R"({"type":"feature.move","v":1,"featureId":"f1","toIndex":0})"),
      Json::parse(R"({"type":"studio.setRollback","v":1,"index":3})"),
      Json::parse(R"({"type":"body.rename","v":1,"body":"f1/body","name":"Lid"})"),
      Json::parse(R"({"type":"body.setVisible","v":1,"body":"f1/body:2","visible":false})"),
      Json::parse(R"({"type":"body.setColor","v":1,"body":"f1/body","color":"#ff8800"})"),
      Json::parse(R"({"type":"body.setMaterial","v":1,"body":"f1/body","material":"brass"})"),
      Json::parse(R"({"type":"document.rename","v":1,"name":"Bracket"})"),
      Json::parse(R"({"type":"batch","v":1,"ops":[
        {"type":"feature.remove","v":1,"featureId":"f2"},
        {"type":"batch","v":1,"ops":[{"type":"document.rename","v":1,"name":"X"}]}]})"),
  };
}

TEST(OperationCodec, CoversEveryOperationType) {
  std::vector<std::string> types;
  for (const auto& op : everyOperation()) types.push_back(op.at("type").get<std::string>());
  ASSERT_EQ(types.size(), ops::OP_VERSION.size());
  for (const auto& [type, version] : ops::OP_VERSION) {
    EXPECT_NE(std::find(types.begin(), types.end(), type), types.end()) << type;
  }
}

TEST(OperationCodec, JsonToProtoToJsonIsTheSameJson) {
  for (const auto& json : everyOperation()) {
    v1::Operation proto;
    operationFromJson(json, &proto);
    const auto back = operationToJson(proto);
    ASSERT_TRUE(back.has_value()) << json.dump() << ": " << back.error().path;
    EXPECT_EQ(*back, json) << back->dump();
    // Equal including number kinds: whole numbers are integers, as JSON.stringify writes them.
    EXPECT_EQ(back->dump(), json.dump());
  }
}

TEST(OperationCodec, ProtoToJsonToProtoIsTheSameMessage) {
  for (const auto& json : everyOperation()) {
    v1::Operation proto;
    operationFromJson(json, &proto);
    const auto asJson = operationToJson(proto);
    ASSERT_TRUE(asJson.has_value());
    v1::Operation again;
    operationFromJson(*asJson, &again);
    EXPECT_TRUE(MessageDifferencer::Equals(proto, again)) << proto.DebugString();
  }
}

TEST(OperationCodec, WritesTheCurrentVersionOfEachType) {
  v1::Operation op;
  auto* set = op.mutable_feature_set_params();
  set->set_feature_id("f1");
  set->set_type_version(1);
  const auto json = operationToJson(op);
  ASSERT_TRUE(json.has_value());
  EXPECT_EQ(json->at("v"), 2);
  EXPECT_EQ(json->at("params"), Json::object());
}

TEST(OperationCodec, AWholeNumberInParamsStaysAnInteger) {
  v1::Operation op;
  auto* set = op.mutable_feature_set_params();
  set->set_feature_id("f1");
  set->set_type_version(1);
  (*set->mutable_params()->mutable_fields())["width"].set_number_value(2.0);
  (*set->mutable_params()->mutable_fields())["depth"].set_number_value(0.25);
  const auto json = operationToJson(op);
  ASSERT_TRUE(json.has_value());
  EXPECT_TRUE(json->at("params").at("width").is_number_integer());
  EXPECT_EQ(json->at("params").dump(), R"({"depth":0.25,"width":2})");
}

TEST(OperationCodec, BodySetColorWithoutColorIsNull) {
  v1::Operation op;
  op.mutable_body_set_color()->set_body_id("f1/body");
  const auto json = operationToJson(op);
  ASSERT_TRUE(json.has_value());
  EXPECT_TRUE(json->at("color").is_null());

  v1::Operation back;
  operationFromJson(*json, &back);
  EXPECT_FALSE(back.body_set_color().has_color());
}

TEST(OperationCodec, AnEmptyOperationIsRefusedAtOp) {
  const auto json = operationToJson(v1::Operation());
  ASSERT_FALSE(json.has_value());
  EXPECT_EQ(json.error().reason, ErrorReason::InvalidOperation);
  EXPECT_EQ(json.error().path, "op");
}

TEST(OperationCodec, AnEmptyBatchEntryIsRefusedWithItsIndex) {
  v1::Operation op;
  auto* batch = op.mutable_batch();
  batch->add_ops()->mutable_document_rename()->set_name("A");
  batch->add_ops()->mutable_document_rename()->set_name("B");
  batch->add_ops();  // empty oneof
  const auto json = operationToJson(op);
  ASSERT_FALSE(json.has_value());
  EXPECT_EQ(json.error().reason, ErrorReason::InvalidOperation);
  EXPECT_EQ(json.error().path, "op.batch.ops[2]");
}

TEST(OperationCodec, AnEmptyEntryOfANestedBatchHasTheWholePath) {
  v1::Operation op;
  auto* inner = op.mutable_batch()->add_ops();
  inner->mutable_batch()->add_ops();
  const auto json = operationToJson(op);
  ASSERT_FALSE(json.has_value());
  EXPECT_EQ(json.error().path, "op.batch.ops[0].batch.ops[0]");
}

TEST(OperationCodec, AnUnspecifiedMaterialIsRefused) {
  v1::Operation op;
  op.mutable_body_set_material()->set_body_id("f1/body");
  const auto json = operationToJson(op);
  ASSERT_FALSE(json.has_value());
  EXPECT_EQ(json.error().reason, ErrorReason::InvalidOperation);
  EXPECT_EQ(json.error().path, "op.body_set_material.material");

  v1::Operation batch;
  batch.mutable_batch()->add_ops()->mutable_body_set_material()->set_body_id("f1/body");
  const auto nested = operationToJson(batch);
  ASSERT_FALSE(nested.has_value());
  EXPECT_EQ(nested.error().path, "op.batch.ops[0].body_set_material.material");
}

TEST(OperationCodec, ContentIsNotValidated) {
  // An empty feature id is the handler's to refuse (INVALID_OPERATION with its path), not the
  // codec's: only what the wire alone can get wrong is checked here.
  v1::Operation op;
  op.mutable_feature_remove();
  const auto json = operationToJson(op);
  ASSERT_TRUE(json.has_value());
  EXPECT_EQ(json->at("featureId"), "");
}

TEST(FeatureToProto, CopiesEveryField) {
  document::FeatureInstance feature;
  feature.id = document::FeatureId("f1");
  feature.type = "cylinder";
  feature.typeVersion = 2;
  feature.name = "Cylinder 1";
  feature.suppressed = true;
  feature.params = std::make_shared<const Json>(Json{{"radius", 5}, {"axis", "z"}});

  v1::FeatureInstance out;
  featureToProto(feature, &out);
  EXPECT_EQ(out.id(), "f1");
  EXPECT_EQ(out.type(), "cylinder");
  EXPECT_EQ(out.type_version(), 2u);
  EXPECT_EQ(out.name(), "Cylinder 1");
  EXPECT_TRUE(out.suppressed());
  EXPECT_EQ(out.params().fields().at("radius").number_value(), 5.0);
  EXPECT_EQ(out.params().fields().at("axis").string_value(), "z");
}

TEST(LogEntryView, ConvertsADoEntry) {
  const Json entry = Json::parse(R"({"seq":4,"kind":"do","label":"Box","time":1700000000123.0,
    "op":{"type":"feature.add","v":1},"inverse":{"type":"feature.remove","v":1}})");
  v1::LogEntryView view;
  logEntryView(entry, &view);
  EXPECT_EQ(view.seq(), 4u);
  EXPECT_EQ(view.kind(), v1::LogEntryView::KIND_DO);
  EXPECT_EQ(view.target(), 0u);
  EXPECT_EQ(view.label(), "Box");
  EXPECT_EQ(view.time().seconds(), 1700000000);
  EXPECT_EQ(view.time().nanos(), 123000000);
  EXPECT_EQ(view.op_type(), "feature.add");
}

TEST(LogEntryView, ConvertsUndoAndRedoWithTheirTarget) {
  const Json undo = Json::parse(R"({"seq":5,"kind":"undo","target":4,"label":"Box","time":0,
    "op":{"type":"batch","v":1,"ops":[]},"inverse":{"type":"batch","v":1,"ops":[]}})");
  v1::LogEntryView view;
  logEntryView(undo, &view);
  EXPECT_EQ(view.kind(), v1::LogEntryView::KIND_UNDO);
  EXPECT_EQ(view.target(), 4u);
  EXPECT_EQ(view.op_type(), "batch");

  Json redo = undo;
  redo["kind"] = "redo";
  logEntryView(redo, &view);
  EXPECT_EQ(view.kind(), v1::LogEntryView::KIND_REDO);
}

}  // namespace
}  // namespace tinycad::rpc
