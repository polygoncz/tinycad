// CylinderBuilder (the builder part of test/unit/features/cylinder/cylinder.test.ts).

#include <cmath>

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

Json cylinderParams(core::Vec3 base, const std::string& axis, double radius, double height) {
  return {{"base", {base[0], base[1], base[2]}},
          {"axis", axis},
          {"radius", radius},
          {"height", height}};
}

TEST(CylinderBuilder, AddsOneBodyCreatedAndLastModifiedByTheFeature) {
  CountingKernel kernel;
  const auto built = build(kernel, "cylinder", "c1", cylinderParams({0, 0, 0}, "z", 1, 2));
  const auto body = bodyAt(*built.ok().state, "c1/body");
  EXPECT_EQ(body->origin().str(), "c1");
  EXPECT_EQ(body->lastModifiedBy().str(), "c1");
  EXPECT_EQ(idsOf(*built.ok().state), withOrigin({"c1/body"}));
}

TEST(CylinderBuilder, NamesTheFacesTopBottomAndSideByTheirRoles) {
  CountingKernel kernel;
  const auto body = bodyAt(
      *build(kernel, "cylinder", "c1", cylinderParams({0, 0, 0}, "z", 1, 2)).ok().state, "c1/body");
  EXPECT_EQ(faceNames(*body->names()),
            (std::vector<std::string>{"c1/face:bottom", "c1/face:side", "c1/face:top"}));
}

TEST(CylinderBuilder, StandsAlongTheChosenWorldAxis) {
  CountingKernel kernel;
  for (const auto& [axis, max] : {std::pair{std::string("x"), core::Vec3{3, 1, 1}},
                                  std::pair{std::string("y"), core::Vec3{1, 3, 1}},
                                  std::pair{std::string("z"), core::Vec3{1, 1, 3}}}) {
    const auto body =
        bodyAt(*build(kernel, "cylinder", "c1", cylinderParams({0, 0, 0}, axis, 1, 3)).ok().state,
               "c1/body");
    expectVec(bboxOf(kernel, *body).max, max, 1e-5);
  }
}

}  // namespace
}  // namespace tinycad::features::test
