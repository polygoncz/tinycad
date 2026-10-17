// The runner of the shared cases ops.upcast, ops.replay and ops.script (spec 13, "Druhy
// případů"; the TypeScript twin is test/integration/shared-cases/ops.test.ts): loading
// operations of any version, replaying a stored log into a document and a session script of
// dispatch, transactions and undo/redo. No sorting: the operation contract defines every order.

#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <string>

#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/parse_entry.hpp"
#include "tinycad/ops/replay.hpp"
#include "tinycad/ops/upcast.hpp"

namespace tinycad::testing {
namespace {

using core::Json;

const document::FeatureSchemaRegistry& schemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

// The handlers migrate the feature data of feature.add and feature.setParams with these schemas
// (Q035).
const ops::OpHandlerRegistry& handlers() {
  static const ops::OpHandlerRegistry registry(schemas());
  return registry;
}

/** The DocumentData of a case; a document fromData refuses is a broken case. */
std::unique_ptr<document::Document> loadDocument(const Json& raw) {
  auto loaded = document::fromData(raw, schemas());
  if (!loaded) {
    throw std::runtime_error("input.document: broken at " + loaded.error().issues.at(0).path);
  }
  return std::move(*loaded);
}

Json documentJson(const document::DocumentReader& doc) {
  return document::documentDataJson(document::toData(doc));
}

Json runUpcast(const Json& input) {
  const auto result = ops::upcastOperation(handlers(), input.at("operation"));
  // The path only: the message differs from TS (spec 13, Obálka).
  if (result) return {{"ok", {{"operation", *result}}}};
  return {{"error", {{"path", result.error().path}}}};
}

Json runReplay(const Json& input) {
  auto doc = loadDocument(input.at("document"));
  std::vector<ops::LogEntry> entries;
  const Json& raw = input.at("entries");
  for (std::size_t i = 0; i < raw.size(); ++i) {
    auto parsed = ops::parseLogEntry(handlers(), raw[i]);
    if (!parsed) {
      throw std::runtime_error("entries[" + std::to_string(i) + "]." + parsed.error().path + ": " +
                               parsed.error().message);
    }
    entries.push_back(std::move(*parsed));
  }
  const auto replayed = ops::replayLog(*doc, handlers(), entries);
  if (!replayed) {
    throw std::runtime_error("replay failed at seq " + std::to_string(replayed.error().seq) +
                             ": " + replayed.error().error.message);
  }
  return {{"ok", {{"document", documentJson(*doc)}}}};
}

Json run(const std::string& kind, const Json& input) {
  if (kind == "ops.upcast") return runUpcast(input);
  if (kind == "ops.replay") return runReplay(input);
  throw std::runtime_error("unknown kind " + kind);
}

class OpsSharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(OpsSharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("ops", GetParam());
  const std::string kind = sharedCase.at("kind").get<std::string>();
  ASSERT_EQ(kind.rfind("ops.", 0), 0U) << "a case of another area: " << kind;
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";

  const Json actual = run(kind, sharedCase.at("input"));
  const Tolerance tolerance = resolveTolerance(sharedCase.value("tolerance", Json(nullptr)));
  const auto difference = firstDifference(sharedCase.at("expected"), actual, tolerance);
  EXPECT_FALSE(difference.has_value())
      << GetParam() << ".json: " << sharedCase.at("description").get<std::string>() << "\n"
      << difference.value_or("") << "\nactual: " << actual.dump();
}

std::string testName(const ::testing::TestParamInfo<std::string>& info) {
  std::string name = info.param;
  std::replace(name.begin(), name.end(), '-', '_');
  return name;
}

INSTANTIATE_TEST_SUITE_P(Ops, OpsSharedCase, ::testing::ValuesIn(caseNames("ops")), testName);

TEST(OpsSharedCases, AreFound) { EXPECT_FALSE(caseNames("ops").empty()); }

}  // namespace
}  // namespace tinycad::testing
