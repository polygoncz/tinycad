// Port of test/unit/ops/handler.test.ts and operation.test.ts: the registry of op handlers, the
// built-in types and OP_VERSION, isDocumentRename.

#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::testing {
namespace {

using Strings = std::vector<std::string>;

TEST(OpHandlerRegistry, ContainsTheTwelveBuiltInHandlersAtTheirVersions) {
  const ops::OpHandlerRegistry registry(noSchemas());
  Strings types;
  for (const auto* handler : registry.all()) {
    types.emplace_back(handler->type());
    EXPECT_EQ(handler->version(), ops::opVersion(handler->type()));
  }
  EXPECT_EQ(types, (Strings{"feature.add", "feature.remove", "feature.setParams", "feature.rename",
                            "feature.suppress", "feature.move", "studio.setRollback", "body.rename",
                            "body.setVisible", "body.setColor", "body.setMaterial",
                            "document.rename"}));
  EXPECT_EQ(registry.get("feature.setParams").version(), 2);
}

TEST(OpHandlerRegistry, HasNoHandlerForBatchAndRefusesToRegisterOne) {
  ops::OpHandlerRegistry registry(noSchemas());
  EXPECT_EQ(registry.find("batch"), nullptr);
  EXPECT_THROW(registry.add(std::make_shared<TestHandler>("batch", 1)), core::AssertionError);
}

TEST(OpHandlerRegistry, AcceptsNewHandlersAndRejectsDuplicates) {
  ops::OpHandlerRegistry registry(noSchemas());
  auto custom = std::make_shared<TestHandler>("sketch.noop", 1);
  registry.add(custom);
  EXPECT_EQ(&registry.get("sketch.noop"), custom.get());
  EXPECT_THROW(registry.add(custom), core::AssertionError);
  EXPECT_THROW(registry.add(std::make_shared<TestHandler>("feature.add", 1)), core::AssertionError);
  EXPECT_THROW((void)registry.get("nope"), core::AssertionError);
}

TEST(OpVersion, KnowsEveryTypeAndAssertsOnAnUnknownOne) {
  EXPECT_EQ(ops::opVersion("batch"), 1);
  EXPECT_EQ(ops::opVersion("feature.setParams"), 2);
  EXPECT_THROW((void)ops::opVersion("nope"), core::AssertionError);
}

TEST(IsDocumentRename, AcceptsDocumentRenameWithAStringNameOnly) {
  EXPECT_TRUE(ops::isDocumentRename(Json{{"type", "document.rename"}, {"v", 1}, {"name", "A"}}));
  EXPECT_FALSE(ops::isDocumentRename(renameOp("a", "x")));
  EXPECT_FALSE(ops::isDocumentRename(Json{{"type", "document.rename"}, {"v", 1}}));
  EXPECT_FALSE(ops::isDocumentRename(Json{{"type", "document.rename"}, {"v", 1}, {"name", 3}}));
  EXPECT_FALSE(ops::isDocumentRename(Json::array()));
}

}  // namespace
}  // namespace tinycad::testing
