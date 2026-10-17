// content_version of a body (spec 14, Q100, decision N43).

#include <gtest/gtest.h>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/regen/content_version.hpp"

namespace tinycad::regen::test {
namespace {

std::string versionOf(const RegenSetup& s, const RegenResult& r, const std::string& body) {
  for (const auto& b : r.finalState->bodies()) {
    if (b->id() == body) return s.regenerator->contentVersion(*b);
  }
  throw std::runtime_error("no body " + body);
}

TEST(ContentVersions, IsThePrefixAndTheHandle) {
  const ContentVersions versions("p-1");
  EXPECT_EQ(versions.of(ShapeHandle{42}), "p-1.42");
  EXPECT_EQ(versions.prefix(), "p-1");
  EXPECT_THROW(ContentVersions(""), core::AssertionError);
  EXPECT_THROW(ContentVersions("a.b"), core::AssertionError);
}

TEST(ContentVersions, TwoInstancesHaveDifferentPrefixesOfTheFormStartDashCounter) {
  const ContentVersions a;
  const ContentVersions b;
  EXPECT_NE(a.prefix(), b.prefix());
  EXPECT_EQ(a.prefix().find('.'), std::string::npos);
  EXPECT_NE(a.prefix().find('-'), std::string::npos);
  EXPECT_EQ(a.prefix().substr(0, a.prefix().find('-')), b.prefix().substr(0, b.prefix().find('-')));
}

TEST(RegeneratorContentVersion, StaysForACachedOrUnchangedBodyAndChangesWithANewShape) {
  RegenSetup s;
  auto fs = features(3);
  const auto first = s.regenerator->run(aStudio(fs));
  const auto f1 = versionOf(s, first, "f1/body");
  const auto f3 = versionOf(s, first, "f3/body");
  // Cached: the same version.
  const auto again = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(versionOf(s, again, "f1/body"), f1);
  // f3 rebuilt: a new version, even though the geometry stays the same; f1 untouched.
  fs[2] = std::make_shared<const document::FeatureInstance>(*fs[2]);
  const auto rebuilt = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(versionOf(s, rebuilt, "f1/body"), f1);
  EXPECT_NE(versionOf(s, rebuilt, "f3/body"), f3);
}

TEST(RegeneratorContentVersion, ABodyPassingThroughAFeatureUnchangedKeepsItsVersion) {
  RegenSetup s;
  auto fs = features(2);
  const auto r1 = s.regenerator->run(aStudio({fs[0]}));
  const auto r2 = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(versionOf(s, r2, "f1/body"), versionOf(s, r1, "f1/body"));
}

TEST(RegeneratorContentVersion, TwoRegeneratorsHaveDifferentPrefixes) {
  RegenSetup a;
  RegenSetup b;
  const auto ra = a.regenerator->run(aStudio(features(1)));
  const auto rb = b.regenerator->run(aStudio(features(1)));
  const auto va = versionOf(a, ra, "f1/body");
  const auto vb = versionOf(b, rb, "f1/body");
  EXPECT_NE(va.substr(0, va.find('.')), vb.substr(0, vb.find('.')));
}

}  // namespace
}  // namespace tinycad::regen::test
