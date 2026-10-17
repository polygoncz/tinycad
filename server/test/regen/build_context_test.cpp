// BuildContext (port of test/unit/regen/build-context.test.ts) over OcctKernel: every resolve
// method and its RefError branches, warnings. Texts of errors are not contract (spec 13): the
// tests check the ref and the kind of failure only.

#include <gtest/gtest.h>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

using document::EntityRef;

void expectVec(const core::Vec3& actual, const core::Vec3& expected, double tol = 1e-12) {
  for (std::size_t i = 0; i < 3; ++i) EXPECT_NEAR(actual[i], expected[i], tol) << "component " << i;
}

EntityRef bodyRef(const std::string& origin) {
  return EntityRef::toBody(document::bodyId(fid(origin)));
}
EntityRef topoRef(const std::string& origin, const std::string& name) {
  return EntityRef::toTopo(document::bodyId(fid(origin)), TopoName(name));
}
EntityRef planeRef(const std::string& id) { return EntityRef::toPlane(document::PlaneId(id)); }
EntityRef axisRef(const std::string& id) { return EntityRef::toAxis(document::AxisId(id)); }
EntityRef regionRef(const std::string& sketch, const std::string& region) {
  return EntityRef::toRegion(fid(sketch), region);
}
EntityRef entityRef(const std::string& sketch, const std::string& entity) {
  return EntityRef::toSketchEntity(fid(sketch), entity);
}

const core::Plane kXz{{0, 0, 0}, {1, 0, 0}, {0, -1, 0}};

TEST(BuildContext, GivesTheBuilderATrackedKernel) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  auto box = t->ctx.kernel().makeBox({{0, 0, 0}, {1, 1, 1}});
  ASSERT_TRUE(box);
  EXPECT_EQ(t->owned, OwnedHandles{box->shape});
  EXPECT_EQ(t->ctx.state(), RegenState::empty());
}

TEST(BuildContextBodies, ResolvesBodiesInTheOrderOfRefs) {
  CountingKernel kernel;
  const auto a = aBody("a", ShapeHandle{1});
  const auto b = aBody("b", ShapeHandle{2});
  auto t = aBuildContext(kernel, aState({a, b}));
  auto r = t->ctx.resolveBodies({bodyRef("b"), bodyRef("a")});
  ASSERT_TRUE(r);
  EXPECT_EQ(*r, (std::vector<BodyPtr>{b, a}));
  EXPECT_TRUE(t->ctx.resolveBodies({})->empty());
}

TEST(BuildContextBodies, ReturnsTheFirstUnresolvedReference) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, aState({aBody("a", ShapeHandle{1})}));
  auto r = t->ctx.resolveBodies({bodyRef("a"), bodyRef("x"), bodyRef("y")});
  ASSERT_FALSE(r);
  EXPECT_EQ(r.error().ref, bodyRef("x"));
}

TEST(BuildContextBodies, ReturnsARefErrorForAnArtifactOfAnotherKind) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  const auto plane = EntityRef::toBody(document::BodyId("origin/plane:xy"));
  auto r = t->ctx.resolveBodies({plane});
  ASSERT_FALSE(r);
  EXPECT_EQ(r.error().ref, plane);
}

TEST(BuildContextPlanes, ResolvesTheOriginPlanesInTheOrderOfRefs) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  auto r = t->ctx.resolvePlanes({planeRef("origin/plane:yz"), planeRef("origin/plane:xy")});
  ASSERT_TRUE(r);
  ASSERT_EQ(r->size(), 2U);
  EXPECT_EQ((*r)[0].plane, RegenState::empty()->planes()[2]->plane());
  EXPECT_EQ((*r)[1].ref, planeRef("origin/plane:xy"));
  EXPECT_TRUE(t->ctx.resolvePlanes({})->empty());
}

TEST(BuildContextPlanes, ReturnsTheFirstMissingPlaneAndABodyIdGivenAsAPlane) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, RegenState::empty()->with(aBody("a", ShapeHandle{1})));
  auto missing = t->ctx.resolvePlanes({planeRef("origin/plane:xy"), planeRef("origin/plane:ab")});
  ASSERT_FALSE(missing);
  EXPECT_EQ(missing.error().ref, planeRef("origin/plane:ab"));
  auto body = t->ctx.resolvePlanes({planeRef("a/body")});
  ASSERT_FALSE(body);
}

TEST(BuildContextWarnings, HasNoneWithoutWarnAndJoinsSeveralWithANewline) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  EXPECT_FALSE(t->ctx.warnings().has_value());
  t->ctx.warn("one");
  t->ctx.warn("two");
  EXPECT_EQ(t->ctx.warnings(), "one\ntwo");
}

TEST(BuildContextRegions, ResolvesRegionsOfTwoSketchesInTheOrderOfRefs) {
  CountingKernel kernel;
  const auto s1 = aSketchArtifact("s1", {ShapeHandle{5}});
  const auto s2 = aSketchArtifact("s2", {ShapeHandle{6}, ShapeHandle{7}});
  auto t = aBuildContext(kernel, aState({s1, s2}));
  auto r = t->ctx.resolveRegions({regionRef("s2", "r2"), regionRef("s1", "r1")});
  ASSERT_TRUE(r);
  ASSERT_EQ(r->size(), 2U);
  EXPECT_EQ((*r)[0].sketch, s2);
  EXPECT_EQ((*r)[0].face, ShapeHandle{7});
  EXPECT_EQ((*r)[1].face, ShapeHandle{5});
  EXPECT_TRUE(t->ctx.resolveRegions({})->empty());
}

TEST(BuildContextRegions, ReturnsAMissingSketchAMissingRegionAndAnotherKind) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, aState({aSketchArtifact("s1", {ShapeHandle{5}}),
                                         aBody("f1", ShapeHandle{1})}));
  auto noSketch = t->ctx.resolveRegions({regionRef("s9", "r1")});
  ASSERT_FALSE(noSketch);
  EXPECT_EQ(noSketch.error().ref, regionRef("s9", "r1"));
  auto noRegion = t->ctx.resolveRegions({regionRef("s1", "r2")});
  ASSERT_FALSE(noRegion);
  EXPECT_EQ(noRegion.error().ref, regionRef("s1", "r2"));
  // The body of the feature f1 is not its sketch.
  EXPECT_FALSE(t->ctx.resolveRegions({regionRef("f1", "r1")}));
}

/** A sketch on XZ: line l (1,2)-(1,5), construction line c (0,0)-(3,4), zero line z, circle k, point a. */
StatePtr sketchOnXz() {
  const Json entities = Json::array({{{"id", "a"}, {"kind", "point"}, {"x", 1}, {"y", 2}},
                                     {{"id", "k"}, {"kind", "circle"}},
                                     {{"id", "l"}, {"kind", "line"}},
                                     {{"id", "c"}, {"kind", "line"}},
                                     {{"id", "z"}, {"kind", "line"}}});
  return RegenState::empty()->with(
      aSketchArtifact("s1", {}, kXz,
                      {SketchLineSegment{"l", {1, 2}, {1, 5}},
                       SketchLineSegment{"c", {0, 0}, {3, 4}},
                       SketchLineSegment{"z", {2, 2}, {2, 2}}},
                      entities));
}

TEST(BuildContextAxis, ResolvesTheOriginAxisZ) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  auto r = t->ctx.resolveAxis(axisRef("origin/axis:z"));
  ASSERT_TRUE(r);
  expectVec(r->origin, {0, 0, 0});
  expectVec(r->direction, {0, 0, 1});
}

TEST(BuildContextAxis, ReturnsAMissingAxisAndAPlaneGivenAsAnAxis) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel);
  auto missing = t->ctx.resolveAxis(axisRef("origin/axis:w"));
  ASSERT_FALSE(missing);
  EXPECT_EQ(missing.error().ref, axisRef("origin/axis:w"));
  EXPECT_FALSE(t->ctx.resolveAxis(axisRef("origin/plane:xy")));
}

TEST(BuildContextAxis, TurnsASketchLineOnXzIntoWorldCoordinates) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, sketchOnXz());
  auto r = t->ctx.resolveAxis(entityRef("s1", "l"));
  ASSERT_TRUE(r) << r.error().message;
  // (1, 2) and (1, 5) in XZ are the world points (1, 0, 2) and (1, 0, 5).
  expectVec(r->origin, {1, 0, 2});
  expectVec(r->direction, {0, 0, 1});
}

TEST(BuildContextAxis, ResolvesAConstructionLineWithAUnitDirection) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, sketchOnXz());
  auto r = t->ctx.resolveAxis(entityRef("s1", "c"));
  ASSERT_TRUE(r);
  expectVec(r->origin, {0, 0, 0});
  expectVec(r->direction, {0.6, 0, 0.8});
}

TEST(BuildContextAxis, ReturnsARefErrorForACircleAPointAMissingEntityAndAMissingSketch) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, sketchOnXz());
  for (const auto& ref : {entityRef("s1", "k"), entityRef("s1", "a"), entityRef("s1", "q"),
                          entityRef("s9", "l"), entityRef("s1", "z")}) {
    auto r = t->ctx.resolveAxis(ref);
    ASSERT_FALSE(r) << ref.entity;
    EXPECT_EQ(r.error().ref, ref);
  }
}

TEST(BuildContextTopo, ResolvesFacesAndEdgesByName) {
  CountingKernel kernel;
  const auto body =
      aBody("b", ShapeHandle{1},
            aNameTable({{"b/face:top", {5}}, {"b/face:split", {1, 3}}},
                       {{"edge:x", {2, 0}}, {"edge:y", {4}}}));
  auto t = aBuildContext(kernel, aState({body}));
  auto faces = t->ctx.resolveTopo({topoRef("b", "b/face:top")}, TopoKind::Face);
  ASSERT_TRUE(faces);
  EXPECT_EQ((*faces)[0].body, body);
  EXPECT_EQ((*faces)[0].indices, std::vector<int>{5});
  auto edges = t->ctx.resolveTopo({topoRef("b", "edge:y"), topoRef("b", "edge:x")}, TopoKind::Edge);
  ASSERT_TRUE(edges);
  EXPECT_EQ((*edges)[0].indices, std::vector<int>{4});
  EXPECT_EQ((*edges)[1].indices, (std::vector<int>{0, 2}));
  // Several edges under one name: no warning.
  EXPECT_FALSE(t->ctx.warnings().has_value());
  auto split = t->ctx.resolveTopo({topoRef("b", "b/face:split")}, TopoKind::Face);
  ASSERT_TRUE(split);
  EXPECT_EQ((*split)[0].indices, (std::vector<int>{1, 3}));
  ASSERT_TRUE(t->ctx.warnings().has_value());
  EXPECT_EQ(t->ctx.warnings()->find('\n'), std::string::npos);
  EXPECT_TRUE(t->ctx.resolveTopo({}, TopoKind::Edge)->empty());
}

TEST(BuildContextTopo, LooksFaceNamesUpOnlyAmongFacesAndReturnsTheFirstMissing) {
  CountingKernel kernel;
  const auto body = aBody("b", ShapeHandle{1}, aNameTable({{"b/face:top", {0}}}, {{"edge:x", {0}}}));
  auto t = aBuildContext(kernel, aState({body}));
  EXPECT_FALSE(t->ctx.resolveTopo({topoRef("b", "edge:x")}, TopoKind::Face));
  EXPECT_FALSE(t->ctx.resolveTopo({topoRef("b", "b/face:top")}, TopoKind::Edge));
  auto r = t->ctx.resolveTopo({topoRef("b", "b/face:top"), topoRef("b", "b/face:gone")},
                              TopoKind::Face);
  ASSERT_FALSE(r);
  EXPECT_EQ(r.error().ref, topoRef("b", "b/face:gone"));
  EXPECT_FALSE(t->ctx.resolveTopo({topoRef("x", "b/face:top")}, TopoKind::Face));
  const auto plane = EntityRef::toTopo(document::BodyId("origin/plane:xy"), TopoName("f"));
  EXPECT_FALSE(aBuildContext(kernel)->ctx.resolveTopo({plane}, TopoKind::Face));
}

TEST(BuildContextPlanesOfFaces, GivesTheFrameOfXyAtZ10ForTheTopFaceAndXzForTheFront) {
  CountingKernel kernel;
  auto box = kernel.makeBox({{0, 0, 0}, {10, 10, 10}});
  auto names = nameShape(kernel, fid("b"), *box, {});
  auto t = aBuildContext(kernel, RegenState::empty()->with(aBody("b", box->shape, *names)));
  auto top = t->ctx.resolvePlanes({topoRef("b", "b/face:top"), planeRef("origin/plane:xz")});
  ASSERT_TRUE(top);
  expectVec((*top)[0].plane.origin, {0, 0, 10}, 1e-9);
  expectVec((*top)[0].plane.xDir, {1, 0, 0}, 1e-9);
  expectVec((*top)[0].plane.normal, {0, 0, 1}, 1e-9);
  EXPECT_EQ((*top)[1].ref.kind, document::RefKind::Plane);
  auto front = t->ctx.resolvePlanes({topoRef("b", "b/face:front")});
  ASSERT_TRUE(front);
  expectVec((*front)[0].plane.origin, kXz.origin, 1e-9);
  expectVec((*front)[0].plane.xDir, kXz.xDir, 1e-9);
  expectVec((*front)[0].plane.normal, kXz.normal, 1e-9);
  EXPECT_FALSE(t->ctx.warnings().has_value());
  EXPECT_FALSE(t->ctx.resolvePlanes({topoRef("b", "b/face:gone")}));
  EXPECT_FALSE(t->ctx.resolvePlanes({topoRef("x", "b/face:top")}));
}

TEST(BuildContextPlanesOfFaces, TakesTheSmallestIndexAndWarnsWhenTheNameMatchesSeveral) {
  CountingKernel kernel;
  kernel::TopologySummary topology;
  for (int i = 0; i < 5; ++i) {
    topology.faces.push_back(kernel::FaceInfo{kernel::SurfaceType::Plane,
                                              kernel::FacePlane{{0, 0, double(i)}, {0, 0, 1}}});
  }
  auto t = aBuildContext(
      kernel, aState({aBody("b", ShapeHandle{1}, aNameTable({{"b/face:split", {4, 2}}}, {}, topology))}));
  auto r = t->ctx.resolvePlanes({topoRef("b", "b/face:split")});
  ASSERT_TRUE(r);
  expectVec((*r)[0].plane.origin, {0, 0, 2});
  ASSERT_TRUE(t->ctx.warnings().has_value());
  EXPECT_EQ(t->ctx.warnings()->find('\n'), std::string::npos);
}

TEST(BuildContextPlanesOfFaces, ReturnsARefErrorForAFaceThatIsNotPlanar) {
  CountingKernel kernel;
  auto t = aBuildContext(kernel, aState({aBody("b", ShapeHandle{1}, aNameTable({{"c/face:side", {0}}}))}));
  auto r = t->ctx.resolvePlanes({topoRef("b", "c/face:side")});
  ASSERT_FALSE(r);
  EXPECT_EQ(r.error().ref, topoRef("b", "c/face:side"));
}

}  // namespace
}  // namespace tinycad::regen::test
