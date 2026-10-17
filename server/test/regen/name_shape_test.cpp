// nameShape (spec 08; port of test/unit/regen/name-shape.test.ts) over OcctKernel: the topology of
// the result and propagateNames, nothing more. Plus the test helper aNameTable.

#include <gtest/gtest.h>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

TopoName tn(const std::string& s) { return TopoName(s); }

TEST(NameShape, NamesTheFacesOfABoxByItsRoles) {
  CountingKernel kernel;
  auto result = kernel.makeBox({{0, 0, 0}, {10, 10, 10}});
  ASSERT_TRUE(result);
  auto names = nameShape(kernel, fid("b"), *result, {});
  ASSERT_TRUE(names);
  const int top = result->roles->at("face:top").at(0).index;
  EXPECT_EQ((*names)->faces(tn("b/face:top")), std::vector<int>{top});
  EXPECT_EQ((*names)->faceEntries().size(), 6U);
  EXPECT_EQ((*names)->edgeEntries().size(), 12U);
  EXPECT_EQ((*names)->topology().faces.size(), 6U);
  EXPECT_EQ(kernel.calls("topology"), 1);
}

TEST(NameShape, CarriesTheNamesOfTheInputOverTheHistoryOfATransform) {
  CountingKernel kernel;
  auto box = kernel.makeBox({{0, 0, 0}, {1, 1, 1}});
  auto boxNames = nameShape(kernel, fid("b"), *box, {});
  ASSERT_TRUE(boxNames);
  const core::Mat4 move{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1};
  auto moved = kernel.transform(box->shape, move);
  ASSERT_TRUE(moved);
  auto names = nameShape(kernel, fid("t"), *moved, {*boxNames});
  ASSERT_TRUE(names);
  EXPECT_EQ((*names)->faceEntries(), (*boxNames)->faceEntries());
  EXPECT_EQ((*names)->edgeEntries(), (*boxNames)->edgeEntries());
}

TEST(NameShape, PassesTheGeneratedTagOn) {
  CountingKernel kernel;
  auto box = kernel.makeBox({{0, 0, 0}, {1, 1, 1}});
  auto boxNames = nameShape(kernel, fid("b"), *box, {});
  const std::vector<int> edges{0};
  auto filleted = kernel.fillet(box->shape, edges, 0.1);
  ASSERT_TRUE(filleted);
  auto names = nameShape(kernel, fid("f"), *filleted, {*boxNames}, "fillet");
  ASSERT_TRUE(names);
  bool found = false;
  for (const auto& [name, indices] : (*names)->faceEntries()) {
    if (name.str().starts_with("f/face:fillet:edge:")) found = true;
  }
  EXPECT_TRUE(found);
}

TEST(NameShape, ReturnsTheErrorOfTheKernel) {
  CountingKernel kernel;
  auto box = kernel.makeBox({{0, 0, 0}, {1, 1, 1}});
  kernel.failNext("topology", {kernel::KernelErrorCode::Internal, "boom"});
  auto names = nameShape(kernel, fid("b"), *box, {});
  ASSERT_FALSE(names);
  EXPECT_EQ(names.error().message, "boom");
}

TEST(ANameTable, BuildsATableFromNamesWithADefaultTopology) {
  const auto t = aNameTable({{"b/face:top", {5}}, {"b/face:a", {5, 2}}}, {{"edge:x", {3}}});
  EXPECT_EQ(t->faces(tn("b/face:a")), (std::vector<int>{2, 5}));
  EXPECT_EQ(t->nameOfFace(5), tn("b/face:a"));
  EXPECT_EQ(t->namesOfFace(5), (std::vector<TopoName>{tn("b/face:a"), tn("b/face:top")}));
  EXPECT_EQ(t->nameOfEdge(3), tn("edge:x"));
  EXPECT_TRUE(t->edges(tn("edge:y")).empty());
  EXPECT_EQ(t->topology().faces.size(), 6U);
  EXPECT_EQ(t->topology().faces[0].surface, kernel::SurfaceType::Other);
  EXPECT_EQ(t->topology().edges.size(), 4U);
  EXPECT_TRUE(aNameTable()->faceEntries().empty());
}

}  // namespace
}  // namespace tinycad::regen::test
