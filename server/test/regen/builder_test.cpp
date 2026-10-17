// The builder registry, unresolvedReference and kernelFailure (port of
// test/unit/regen/builder.test.ts).

#include <gtest/gtest.h>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::regen::test {
namespace {

TEST(FeatureBuilderRegistry, FindsABuilderByItsTypeInRegistrationOrder) {
  FeatureBuilderRegistry builders;
  auto box = std::make_shared<CubeBuilder>("box");
  auto cyl = std::make_shared<CubeBuilder>("cylinder");
  builders.add(box);
  builders.add(cyl);
  EXPECT_EQ(builders.find("box"), box.get());
  EXPECT_EQ(builders.all(), (std::vector<const FeatureBuilder*>{box.get(), cyl.get()}));
}

TEST(FeatureBuilderRegistry, ThrowsOnADuplicateTypeAndANullBuilder) {
  FeatureBuilderRegistry builders;
  builders.add(std::make_shared<CubeBuilder>("box"));
  EXPECT_THROW(builders.add(std::make_shared<CubeBuilder>("box")), core::AssertionError);
  EXPECT_THROW(builders.add(nullptr), core::AssertionError);
}

TEST(FeatureBuilderRegistry, ReturnsNullForAnUnknownType) {
  EXPECT_EQ(FeatureBuilderRegistry().find("cylinder"), nullptr);
}

TEST(UnresolvedReference, IsAnUnresolvedReferenceWithTheMessageAndAnIssueAtTheParam) {
  const RefError e{document::EntityRef::toBody(document::BodyId("box1/body")),
                   "Body box1/body not found"};
  const FeatureError error = unresolvedReference("tools", e);
  EXPECT_EQ(error.code, FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(error.message, "Body box1/body not found");
  ASSERT_EQ(error.issues.size(), 1U);
  EXPECT_EQ(error.issues[0].param, "tools");
  EXPECT_EQ(error.issues[0].code, "param.unresolvedRef");
  EXPECT_TRUE(error.issues[0].params.is_null());
}

TEST(KernelFailure, MapsTheKernelCodeToTheIssueCode) {
  const auto codeOf = [](kernel::KernelErrorCode code) {
    const FeatureError e = kernelFailure({code, "boom"});
    EXPECT_EQ(e.code, FeatureErrorCode::Kernel);
    EXPECT_EQ(e.message, "boom");
    EXPECT_EQ(e.issues.size(), 1U);
    EXPECT_EQ(e.issues[0].param, "");
    return e.issues[0].code;
  };
  EXPECT_EQ(codeOf(kernel::KernelErrorCode::OperationFailed), "kernel.operationFailed");
  EXPECT_EQ(codeOf(kernel::KernelErrorCode::InvalidInput), "kernel.invalidInput");
  EXPECT_EQ(codeOf(kernel::KernelErrorCode::Internal), "kernel.internal");
  EXPECT_EQ(codeOf(kernel::KernelErrorCode::UnknownHandle), "kernel.internal");
}

}  // namespace
}  // namespace tinycad::regen::test
