// modifyBody and the body operation of Extrude and Revolve (spec 07 "Operace tělesa"; port of
// test/unit/regen/body-change.test.ts and body-operation.test.ts) over OcctKernel: identity of the
// new or changed bodies, order of the state, the boolean calls made, the names.
//
// Difference to TS: the FakeKernel boolean kept only the names of the first input; OCCT carries
// the names of every input face that survives, so the name checks are subsets, not equalities.

#include "tinycad/regen/body_operation.hpp"

#include <gtest/gtest.h>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::regen::test {
namespace {

using Call = CountingKernel::BooleanCall;
const FeatureId kFeature = fid("e1");

std::vector<std::string> idsOf(const RegenState& state) {
  std::vector<std::string> ids;
  for (const auto& a : state.artifacts()) ids.push_back(a->id());
  return ids;
}

std::vector<std::string> withOrigin(std::vector<std::string> rest) {
  std::vector<std::string> ids = idsOf(*RegenState::empty());
  ids.insert(ids.end(), rest.begin(), rest.end());
  return ids;
}

BodyPtr bodyAt(const RegenState& state, const std::string& id) {
  const auto a = state.find(id);
  if (a == nullptr || a->kind() != ArtifactKind::Body) throw std::runtime_error("no body " + id);
  return std::static_pointer_cast<const Body>(a);
}

bool hasAllFaceNames(const NameTable& t, const NameTable& of) {
  for (const auto& [name, indices] : of.faceEntries()) {
    if (!t.faceEntries().contains(name)) return false;
  }
  return true;
}

/** The rectangle [x0, x0 + w] × [y0, y0 + h] on the plane z = z0 extruded along +Z by `height`. */
kernel::ShapeResult prism(kernel::ModelingKernel& kernel, core::Vec3 at, core::Vec3 size) {
  const auto [x0, y0, z0] = at;
  const auto [w, h, height] = size;
  const std::vector<core::Vec2> c{{x0, y0}, {x0 + w, y0}, {x0 + w, y0 + h}, {x0, y0 + h}};
  kernel::ProfileLoop outer;
  for (std::size_t i = 0; i < 4; ++i) {
    outer.push_back(core::Curve2::line(c[i], c[(i + 1) % 4], "l" + std::to_string(i + 1)));
  }
  auto face = kernel.makeFace({core::Plane{{0, 0, z0}, {1, 0, 0}, {0, 0, 1}}, outer, {}});
  if (!face) throw std::runtime_error(face.error().message);
  auto result = kernel.extrude(face->shape, {0, 0, 1}, height);
  if (!result) throw std::runtime_error(result.error().message);
  return *result;
}

BodyPtr boxBody(kernel::ModelingKernel& kernel, const std::string& origin, core::Vec3 at) {
  auto result = kernel.makeBox({at, {10, 10, 10}});
  auto names = nameShape(kernel, fid(origin), *result, {});
  return aBody(origin, result->shape, *names);
}

/** Three bodies a, b, c (boxes 10 apart along x) around a sketch, and two prisms of the feature. */
struct Rig {
  Rig() {
    a = boxBody(kernel, "a", {0, 0, 0});
    b = boxBody(kernel, "b", {20, 0, 0});
    c = boxBody(kernel, "c", {40, 0, 0});
    sketch = aSketchArtifact("s");
    state = RegenState::empty()->with(a)->with(sketch)->with(b)->with(c);
    p1 = prism(kernel, {5, 0, 0}, {20, 5, 5});
    p2 = prism(kernel, {0, 0, 20}, {5, 5, 5});
    kernel.resetCounts();
  }
  CountingKernel kernel;
  BodyPtr a, b, c;
  SketchArtifactPtr sketch;
  StatePtr state;
  kernel::ShapeResult p1, p2;
};

StatePtr apply(Rig& s, BodyOperation op, std::vector<kernel::ShapeResult> shapes,
               std::vector<BodyPtr> targets) {
  auto out = applyBodyOperation(s.kernel, s.state, kFeature, op, shapes, targets);
  if (!out) throw std::runtime_error(out.error().message);
  return *out;
}

TEST(ModifyBody, KeepsIdAndOriginTakesTheNewShapeAndNamesItTheFeatureIsLastModifiedBy) {
  CountingKernel kernel;
  const auto body = boxBody(kernel, "a", {0, 0, 0});
  // A result over the same shape whose face 0 is generated from face 0 of the input.
  const kernel::SubShapeIndex face0{kernel::SubShapeType::Face, 0};
  const kernel::ShapeResult result{
      body->shape(), kernel::ShapeHistory{{}, {kernel::HistoryLink{0, face0, {face0}}}, {}},
      std::nullopt};
  const auto source = body->names()->nameOfFace(0);
  ASSERT_TRUE(source.has_value());
  auto out = modifyBody(kernel, fid("f"), *body, result, {body->names()}, "fillet");
  ASSERT_TRUE(out);
  EXPECT_EQ((*out)->id(), body->id());
  EXPECT_EQ((*out)->origin().str(), "a");
  EXPECT_EQ((*out)->lastModifiedBy().str(), "f");
  EXPECT_EQ((*out)->shape(), result.shape);
  EXPECT_EQ((*out)->names()->nameOfFace(0), TopoName("f/face:fillet:" + source->str()));
  // The input body stays as it is.
  EXPECT_EQ(body->lastModifiedBy().str(), "a");
  auto plain = modifyBody(kernel, fid("f"), *body, result, {body->names()});
  ASSERT_TRUE(plain);
  EXPECT_EQ((*plain)->names()->nameOfFace(0), TopoName("f/face:gen:" + source->str()));
}

TEST(ParseBodyOperation, ReadsTheFourOperations) {
  EXPECT_EQ(parseBodyOperation("new"), BodyOperation::New);
  EXPECT_EQ(parseBodyOperation("add"), BodyOperation::Add);
  EXPECT_EQ(parseBodyOperation("remove"), BodyOperation::Remove);
  EXPECT_EQ(parseBodyOperation("intersect"), BodyOperation::Intersect);
  EXPECT_FALSE(parseBodyOperation("union").has_value());
}

TEST(ApplyBodyOperationNew, MakesOneShapeANewBodyAtTheEndWithoutABoolean) {
  Rig s;
  const auto out = apply(s, BodyOperation::New, {s.p1}, {});
  EXPECT_TRUE(s.kernel.booleanCalls().empty());
  EXPECT_EQ(idsOf(*out), withOrigin({"a/body", "s/sketch", "b/body", "c/body", "e1/body"}));
  const auto body = bodyAt(*out, "e1/body");
  EXPECT_EQ(body->origin(), kFeature);
  EXPECT_EQ(body->lastModifiedBy(), kFeature);
  EXPECT_EQ(body->shape(), s.p1.shape);
  // Names by the roles of the prism (M14).
  EXPECT_EQ(body->names()->faces(TopoName("e1/face:start")).size(), 1U);
  EXPECT_EQ(body->names()->faces(TopoName("e1/face:end")).size(), 1U);
  EXPECT_EQ(body->names()->faces(TopoName("e1/face:side:l1")).size(), 1U);
}

TEST(ApplyBodyOperationNew, UnitesSeveralShapesIntoOneBodyWithASingleUnion) {
  Rig s;
  const auto out = apply(s, BodyOperation::New, {s.p1, s.p2}, {});
  ASSERT_EQ(s.kernel.booleanCalls().size(), 1U);
  EXPECT_EQ(s.kernel.booleanCalls()[0],
            (Call{kernel::BooleanOp::Union, {s.p1.shape}, {s.p2.shape}}));
  const auto body = bodyAt(*out, "e1/body");
  auto box = s.kernel.boundingBox(body->shape());
  ASSERT_TRUE(box);
  EXPECT_NEAR(box->max[0], 25, 1e-5);
  EXPECT_NEAR(box->max[2], 25, 1e-5);
  EXPECT_EQ(out->bodies().size(), 4U);
  EXPECT_FALSE(body->names()->faces(TopoName("e1/face:start")).empty());
}

TEST(ApplyBodyOperationNew, IgnoresTargets) {
  Rig s;
  const auto out = apply(s, BodyOperation::New, {s.p1}, {s.a});
  EXPECT_TRUE(s.kernel.booleanCalls().empty());
  EXPECT_EQ(bodyAt(*out, "a/body"), s.a);
}

TEST(ApplyBodyOperationAdd, UnitesTheFirstTargetWithTheOtherTargetsAndTheShapes) {
  Rig s;
  const auto out = apply(s, BodyOperation::Add, {s.p1, s.p2}, {s.c, s.a});
  ASSERT_EQ(s.kernel.booleanCalls().size(), 1U);
  EXPECT_EQ(
      s.kernel.booleanCalls()[0],
      (Call{kernel::BooleanOp::Union, {s.c->shape()}, {s.a->shape(), s.p1.shape, s.p2.shape}}));
  // The result keeps the identity and the place of the first target c; a is consumed.
  EXPECT_EQ(idsOf(*out), withOrigin({"s/sketch", "b/body", "c/body"}));
  const auto result = bodyAt(*out, "c/body");
  EXPECT_EQ(result->origin().str(), "c");
  EXPECT_EQ(result->lastModifiedBy(), kFeature);
  EXPECT_NE(result->shape(), s.c->shape());
  EXPECT_EQ(bodyAt(*out, "b/body"), s.b);
  // The names go over the history of the union: every face of c survives untouched.
  EXPECT_TRUE(hasAllFaceNames(*result->names(), *s.c->names()));
}

TEST(ApplyBodyOperationRemoveIntersect, CallsTheBooleanForEachTargetOnItsOwnAndKeepsTheirIdentity) {
  for (const auto& [op, booleanOp] :
       {std::pair{BodyOperation::Remove, kernel::BooleanOp::Subtract},
        std::pair{BodyOperation::Intersect, kernel::BooleanOp::Intersect}}) {
    Rig s;
    const auto out = apply(s, op, {s.p1, s.p2}, {s.b, s.a});
    EXPECT_EQ(s.kernel.booleanCalls(),
              (std::vector<Call>{Call{booleanOp, {s.b->shape()}, {s.p1.shape, s.p2.shape}},
                                 Call{booleanOp, {s.a->shape()}, {s.p1.shape, s.p2.shape}}}));
    EXPECT_EQ(idsOf(*out), withOrigin({"a/body", "s/sketch", "b/body", "c/body"}));
    for (const auto& target : {s.a, s.b}) {
      const auto changed = bodyAt(*out, target->id());
      EXPECT_EQ(changed->origin(), target->origin());
      EXPECT_EQ(changed->lastModifiedBy(), kFeature);
      EXPECT_NE(changed->shape(), target->shape());
      EXPECT_NE(changed->names(), target->names());
      // The names of each target go over the history of its own boolean (M14).
      EXPECT_TRUE(changed->names()->faceEntries().contains(
          TopoName(target->id().substr(0, 1) + "/face:bottom")));
      if (op == BodyOperation::Remove) {
        EXPECT_TRUE(hasAllFaceNames(*changed->names(), *target->names()));
      }
    }
    EXPECT_EQ(bodyAt(*out, "c/body"), s.c);
  }
}

TEST(ApplyBodyOperation, LeavesTheInputStateAsItWas) {
  Rig s;
  const auto before = s.state->artifacts();
  for (const auto op :
       {BodyOperation::New, BodyOperation::Add, BodyOperation::Remove, BodyOperation::Intersect}) {
    const auto out = apply(s, op, {s.p1}, {s.a});
    EXPECT_NE(out, s.state);
  }
  EXPECT_EQ(s.state->artifacts(), before);
}

TEST(ApplyBodyOperation, LetsAKernelErrorThrough) {
  Rig s;
  s.kernel.failNext("boolean", {kernel::KernelErrorCode::OperationFailed, "boom"});
  auto out = applyBodyOperation(s.kernel, s.state, kFeature, BodyOperation::Remove, {s.p1}, {s.a});
  ASSERT_FALSE(out);
  EXPECT_EQ(out.error().code, kernel::KernelErrorCode::OperationFailed);
  // An empty result of OCCT is a kernel error too: c minus a disjoint prism is fine, but
  // intersecting c with p2 gives nothing.
  auto empty =
      applyBodyOperation(s.kernel, s.state, kFeature, BodyOperation::Intersect, {s.p2}, {s.c});
  ASSERT_FALSE(empty);
  EXPECT_EQ(empty.error().code, kernel::KernelErrorCode::OperationFailed);
}

TEST(ApplyBodyOperation, ThrowsOnNoShapesAndOnAChangeWithoutTargets) {
  Rig s;
  EXPECT_THROW((void)applyBodyOperation(s.kernel, s.state, kFeature, BodyOperation::New, {}, {}),
               core::AssertionError);
  for (const auto op : {BodyOperation::Add, BodyOperation::Remove, BodyOperation::Intersect}) {
    EXPECT_THROW((void)applyBodyOperation(s.kernel, s.state, kFeature, op, {s.p1}, {}),
                 core::AssertionError);
  }
}

}  // namespace
}  // namespace tinycad::regen::test
