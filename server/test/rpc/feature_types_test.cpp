// FeatureTypeDescriptor from the C++ schemas (spec 14 "Schéma featur", Q098, Q105): the
// descriptor of every built-in type, VisibleWhen of the shared cases schema.visibleWhen evaluated
// over the converted descriptor, and the golden file test/golden/feature-types.json shared with
// the TypeScript client (N75, N88).
//
// The golden file is rewritten with TINYCAD_UPDATE_GOLDEN=1 (for example after the sketch schema
// of M44.1 joins registerBuiltInSchemas); otherwise a difference fails.

#include "tinycad/rpc/feature_types.hpp"

#include <gtest/gtest.h>
#include <google/protobuf/util/json_util.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "support/shared_cases.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/v1/session.pb.h"

namespace tinycad::rpc {
namespace {

namespace v1 = tinycad::v1;
using core::Json;
using document::ParamKind;

const document::FeatureSchemaRegistry& schemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

/** A message as protobuf JSON (proto field names), parsed into nlohmann JSON. */
Json protoJson(const google::protobuf::Message& message) {
  std::string text;
  google::protobuf::util::JsonPrintOptions options;
  options.preserve_proto_field_names = true;
  const auto status = google::protobuf::util::MessageToJsonString(message, &text, options);
  EXPECT_TRUE(status.ok()) << status.ToString();
  return Json::parse(text);
}

const v1::FeatureTypeDescriptor* descriptorOf(
    const std::vector<v1::FeatureTypeDescriptor>& descriptors, const std::string& type) {
  for (const auto& d : descriptors) {
    if (d.type() == type) return &d;
  }
  return nullptr;
}

v1::ParamDescriptor::SpecCase expectedCase(ParamKind kind) {
  switch (kind) {
    case ParamKind::Length:
      return v1::ParamDescriptor::kLength;
    case ParamKind::Angle:
      return v1::ParamDescriptor::kAngle;
    case ParamKind::Number:
      return v1::ParamDescriptor::kNumber;
    case ParamKind::Boolean:
      return v1::ParamDescriptor::kBoolean;
    case ParamKind::Enum:
      return v1::ParamDescriptor::kEnumeration;
    case ParamKind::Point:
      return v1::ParamDescriptor::kPoint;
    case ParamKind::Data:
      return v1::ParamDescriptor::kData;
    case ParamKind::Bodies:
      return v1::ParamDescriptor::kBodies;
    case ParamKind::Topo:
      return v1::ParamDescriptor::kTopo;
    case ParamKind::Region:
      return v1::ParamDescriptor::kRegion;
    case ParamKind::Planes:
      return v1::ParamDescriptor::kPlanes;
    case ParamKind::Axis:
      return v1::ParamDescriptor::kAxis;
  }
  return v1::ParamDescriptor::SPEC_NOT_SET;
}

/** The descriptor's VisibleWhen back as the C++ data (what the client evaluates). */
document::VisibleWhen visibleWhenOf(const v1::VisibleWhen& proto) {
  document::VisibleWhen when;
  when.param = proto.param();
  switch (proto.test_case()) {
    case v1::VisibleWhen::kEqualsAny:
      when.test = document::VisibleWhen::Test::EqualsAny;
      for (const auto& v : protoJson(proto.equals_any())) when.values.push_back(v);
      break;
    case v1::VisibleWhen::kEqualsNone:
      when.test = document::VisibleWhen::Test::EqualsNone;
      for (const auto& v : protoJson(proto.equals_none())) when.values.push_back(v);
      break;
    case v1::VisibleWhen::kLessThan:
      when.test = document::VisibleWhen::Test::LessThan;
      when.limit = proto.less_than();
      break;
    case v1::VisibleWhen::TEST_NOT_SET:
      ADD_FAILURE() << "VisibleWhen of '" << proto.param() << "' without a test";
      break;
  }
  return when;
}

TEST(DescribeFeatureTypes, DescribesEveryRegisteredTypeInRegistrationOrder) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto all = schemas().all();
  ASSERT_EQ(descriptors.size(), all.size());
  for (std::size_t i = 0; i < all.size(); ++i) {
    EXPECT_EQ(descriptors[i].type(), all[i]->type());
    EXPECT_EQ(descriptors[i].version(), static_cast<std::uint32_t>(all[i]->version()));
    EXPECT_EQ(descriptors[i].label(), all[i]->label());
    EXPECT_EQ(descriptors[i].icon(), all[i]->icon());
  }
}

TEST(DescribeFeatureTypes, EveryParamMatchesItsSpec) {
  const auto descriptors = describeFeatureTypes(schemas());
  for (const auto* schema : schemas().all()) {
    const auto* d = descriptorOf(descriptors, schema->type());
    ASSERT_NE(d, nullptr) << schema->type();
    const auto& params = schema->params();
    ASSERT_EQ(d->params_size(), static_cast<int>(params.size())) << schema->type();
    for (std::size_t i = 0; i < params.size(); ++i) {
      const auto& spec = params[i].spec;
      const auto& p = d->params(static_cast<int>(i));
      const std::string where = schema->type() + "." + params[i].key;
      EXPECT_EQ(p.key(), params[i].key) << where;
      EXPECT_EQ(p.label(), spec.label) << where;
      EXPECT_EQ(p.group(), spec.group.value_or("")) << where;
      EXPECT_EQ(p.has_visible_when(), spec.visibleWhen.has_value()) << where;
      EXPECT_EQ(p.spec_case(), expectedCase(spec.kind)) << where;
    }
  }
}

TEST(DescribeFeatureTypes, DefaultsAreTheSchemaDefaultsAsAStruct) {
  const auto descriptors = describeFeatureTypes(schemas());
  for (const auto* schema : schemas().all()) {
    const auto* d = descriptorOf(descriptors, schema->type());
    ASSERT_NE(d, nullptr);
    EXPECT_EQ(protoJson(d->defaults()), schema->defaults()) << schema->type();
  }
}

TEST(DescribeFeatureTypes, BoxHasPositiveLengthsAndAPoint) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto* box = descriptorOf(descriptors, "box");
  ASSERT_NE(box, nullptr);
  EXPECT_EQ(box->version(), 1u);
  EXPECT_EQ(box->label(), "box.label");
  EXPECT_EQ(box->icon(), "box");
  ASSERT_EQ(box->params_size(), 4);
  EXPECT_EQ(box->params(0).key(), "origin");
  ASSERT_TRUE(box->params(0).has_point());
  EXPECT_EQ(box->params(0).point().default_value().z(), 0.0);
  const auto& width = box->params(1);
  EXPECT_EQ(width.key(), "width");
  ASSERT_TRUE(width.has_length());
  EXPECT_EQ(width.length().default_value(), 10.0);
  ASSERT_TRUE(width.length().has_min());
  EXPECT_EQ(width.length().min(), 0.0);
  EXPECT_TRUE(width.length().exclusive_min());
  EXPECT_FALSE(width.length().has_max());
  EXPECT_FALSE(width.length().integer());
}

TEST(DescribeFeatureTypes, ExtrudeHasEnumsReferencesAndVisibility) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto* extrude = descriptorOf(descriptors, "extrude");
  ASSERT_NE(extrude, nullptr);

  const auto& operation = extrude->params(1);
  ASSERT_TRUE(operation.has_enumeration());
  EXPECT_EQ(operation.enumeration().default_value(), "new");
  ASSERT_EQ(operation.enumeration().options_size(), 4);
  EXPECT_EQ(operation.enumeration().options(2).value(), "remove");
  EXPECT_EQ(operation.enumeration().options(2).label(), "extrude.operation.remove");

  const auto& targets = extrude->params(2);
  ASSERT_TRUE(targets.has_bodies());
  EXPECT_EQ(targets.bodies().min(), 1u);
  EXPECT_FALSE(targets.bodies().has_max());
  EXPECT_EQ(targets.group(), "extrude.group.merge");
  EXPECT_EQ(targets.visible_when().param(), "operation");
  ASSERT_TRUE(targets.visible_when().has_equals_none());
  EXPECT_EQ(targets.visible_when().equals_none().values(0).string_value(), "new");

  const auto& upTo = extrude->params(5);
  ASSERT_TRUE(upTo.has_topo());
  EXPECT_EQ(upTo.topo().entity(), v1::TopoParam::ENTITY_FACE);
  EXPECT_EQ(upTo.topo().min(), 1u);
  EXPECT_EQ(upTo.topo().max(), 1u);
  ASSERT_TRUE(upTo.visible_when().has_equals_any());
}

TEST(DescribeFeatureTypes, RevolveFlipIsVisibleBelowAFullTurn) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto* revolve = descriptorOf(descriptors, "revolve");
  ASSERT_NE(revolve, nullptr);
  EXPECT_TRUE(revolve->params(1).has_axis());
  const auto& flip = revolve->params(5);
  EXPECT_EQ(flip.key(), "flip");
  ASSERT_TRUE(flip.has_boolean());
  EXPECT_FALSE(flip.boolean().default_value());
  ASSERT_TRUE(flip.visible_when().has_less_than());
  EXPECT_DOUBLE_EQ(flip.visible_when().less_than(), 2 * 3.141592653589793 - 1e-9);
}

TEST(DescribeFeatureTypes, TransformCarriesItsSchemaVersion) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto* transform = descriptorOf(descriptors, "transform");
  ASSERT_NE(transform, nullptr);
  EXPECT_EQ(transform->version(), 3u);
}

// --- schema.visibleWhen over the descriptor -----------------------------------------------------

TEST(DescribeFeatureTypes, BooleanCarriesItsRuleSameBody) {
  const auto descriptors = describeFeatureTypes(schemas());
  const auto* boolean = descriptorOf(descriptors, "boolean");
  ASSERT_NE(boolean, nullptr);
  ASSERT_EQ(boolean->rules_size(), 1);
  const v1::ParamRule& rule = boolean->rules(0);
  EXPECT_EQ(rule.code(), "boolean.sameBody");
  ASSERT_EQ(rule.rule_case(), v1::ParamRule::kDisjointRefs);
  EXPECT_EQ(rule.disjoint_refs().param(), "tools");
  EXPECT_EQ(rule.disjoint_refs().other(), "targets");
}

TEST(DescribeFeatureTypes, OtherTypesHaveNoRules) {
  for (const auto& descriptor : describeFeatureTypes(schemas())) {
    if (descriptor.type() == "boolean") continue;
    EXPECT_EQ(descriptor.rules_size(), 0) << descriptor.type();
  }
}

TEST(DescribeFeatureTypes, VisibleWhenOfTheDescriptorGivesTheSharedCaseResults) {
  const auto descriptors = describeFeatureTypes(schemas());
  int checked = 0;
  for (const auto& name : testing::caseNames("schema")) {
    const Json sharedCase = testing::loadCase("schema", name);
    if (sharedCase.at("kind") != "schema.visibleWhen") continue;
    const Json& input = sharedCase.at("input");
    const std::string type = input.at("type").get<std::string>();
    const std::string param = input.at("param").get<std::string>();

    const auto* d = descriptorOf(descriptors, type);
    ASSERT_NE(d, nullptr) << name << ": no descriptor of '" << type << "'";
    const document::ParamSpec* cppSpec = nullptr;
    for (const auto& entry : schemas().get(type).params()) {
      if (entry.key == param) cppSpec = &entry.spec;
    }
    ASSERT_NE(cppSpec, nullptr) << name;
    const v1::ParamDescriptor* p = nullptr;
    for (const auto& candidate : d->params()) {
      if (candidate.key() == param) p = &candidate;
    }
    ASSERT_NE(p, nullptr) << name;

    document::ParamSpec fromDescriptor;
    if (p->has_visible_when()) fromDescriptor.visibleWhen = visibleWhenOf(p->visible_when());
    const bool visible = document::isParamVisible(fromDescriptor, input.at("params"));
    EXPECT_EQ(visible, sharedCase.at("expected").at("ok").at("visible").get<bool>()) << name;
    EXPECT_EQ(visible, document::isParamVisible(*cppSpec, input.at("params"))) << name;
    ++checked;
  }
  EXPECT_GT(checked, 0) << "no schema.visibleWhen case found";
}

// --- the golden file (N75, N88) -----------------------------------------------------------------

std::filesystem::path goldenFile() {
  const char* fromEnv = std::getenv("TINYCAD_GOLDEN_DIR");
  const std::filesystem::path dir =
      fromEnv != nullptr && *fromEnv != '\0' ? fromEnv : TINYCAD_GOLDEN_DIR;
  return dir / "feature-types.json";
}

/**
 * `{ "feature_types": [ ... ] }`: an OpenSessionResponse with only feature_types, as protobuf
 * JSON with proto field names, so the TS client reads it with fromJson of the generated schema.
 * Keys sorted and indented by nlohmann for a stable, reviewable diff.
 */
std::string goldenText() {
  v1::OpenSessionResponse response;
  for (auto& d : describeFeatureTypes(schemas())) *response.add_feature_types() = std::move(d);
  return protoJson(response).dump(2) + "\n";
}

TEST(FeatureTypesGolden, MatchesTheSharedFile) {
  const std::string expected = goldenText();
  const auto file = goldenFile();
  const char* update = std::getenv("TINYCAD_UPDATE_GOLDEN");
  if (update != nullptr && std::string(update) == "1") {
    std::filesystem::create_directories(file.parent_path());
    std::ofstream out(file, std::ios::binary);
    out << expected;
    ASSERT_TRUE(out.good()) << "cannot write " << file;
    GTEST_SKIP() << "rewrote " << file;
  }
  std::ifstream in(file, std::ios::binary);
  ASSERT_TRUE(in.good()) << "missing " << file << "; run with TINYCAD_UPDATE_GOLDEN=1";
  std::stringstream actual;
  actual << in.rdbuf();
  EXPECT_EQ(Json::parse(actual.str()), Json::parse(expected))
      << file << " differs from the descriptors of the server; run with TINYCAD_UPDATE_GOLDEN=1";
}

}  // namespace
}  // namespace tinycad::rpc
