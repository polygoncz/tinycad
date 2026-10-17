// History of the operations: the contract block `history (M14)` of src/kernel/testing.ts, the
// adapter test test/unit/kernel-occt/occt-history.test.ts and HistoryCollector on a boolean of
// two boxes built directly with OCCT.

#include "history.hpp"

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <gp_Pnt.hxx>
#include <gtest/gtest.h>

#include <string>
#include <variant>
#include <vector>

#include "kernel_test_support.hpp"
#include "shape_table.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

int countOf(const TopologySummary& t, SubShapeType type) {
  switch (type) {
    case SubShapeType::Face:
      return static_cast<int>(t.faces.size());
    case SubShapeType::Edge:
      return static_cast<int>(t.edges.size());
    case SubShapeType::Vertex:
      break;
  }
  return t.vertexCount;
}

void expectAscendingIn(const std::vector<SubShapeIndex>& subs, int count, const std::string& what) {
  for (std::size_t k = 0; k < subs.size(); ++k) {
    EXPECT_TRUE(subs[k].index >= 0 && subs[k].index < count) << what << ": index out of range";
    if (k > 0) {
      EXPECT_GT(subs[k].index, subs[k - 1].index) << what << ": not strictly ascending";
    }
  }
}

int kindOrder(SubShapeType type) {
  return type == SubShapeType::Face ? 0 : type == SubShapeType::Edge ? 1 : 2;
}

/**
 * Spec 06, contract "roles a history": every face of every input exactly once in modified or
 * deleted; modified and deleted only for faces, generated only to faces; indices valid and
 * ascending; entries ordered by input, kind (face, edge, vertex), index.
 */
void expectCompleteHistory(const ShapeHistory& history, const std::vector<TopologySummary>& inputs,
                           const TopologySummary& output, const std::string& what) {
  std::vector<std::vector<int>> seen;
  for (const TopologySummary& t : inputs) seen.emplace_back(t.faces.size(), 0);
  const auto count = [&](int input, int index) {
    ASSERT_TRUE(input >= 0 && input < static_cast<int>(seen.size())) << what;
    auto& row = seen[static_cast<std::size_t>(input)];
    ASSERT_TRUE(index >= 0 && index < static_cast<int>(row.size()))
        << what << ": face out of range";
    ++row[static_cast<std::size_t>(index)];
  };
  const int outputFaces = static_cast<int>(output.faces.size());
  for (const HistoryLink& link : history.modified) {
    EXPECT_EQ(link.from.type, SubShapeType::Face) << what << ": modified from";
    count(link.input, link.from.index);
    for (const SubShapeIndex& s : link.to) EXPECT_EQ(s.type, SubShapeType::Face) << what;
    expectAscendingIn(link.to, outputFaces, what + ": modified to");
  }
  for (const DeletedSubShape& d : history.deleted) {
    EXPECT_EQ(d.sub.type, SubShapeType::Face) << what << ": deleted";
    count(d.input, d.sub.index);
  }
  for (std::size_t input = 0; input < seen.size(); ++input) {
    for (std::size_t face = 0; face < seen[input].size(); ++face) {
      EXPECT_EQ(seen[input][face], 1) << what << ": face " << face << " of input " << input;
    }
  }
  for (const HistoryLink& link : history.generated) {
    ASSERT_TRUE(link.input >= 0 && link.input < static_cast<int>(inputs.size())) << what;
    const int from = countOf(inputs[static_cast<std::size_t>(link.input)], link.from.type);
    EXPECT_TRUE(link.from.index >= 0 && link.from.index < from) << what << ": generated from";
    EXPECT_FALSE(link.to.empty()) << what << ": generated to";
    for (const SubShapeIndex& s : link.to) EXPECT_EQ(s.type, SubShapeType::Face) << what;
    expectAscendingIn(link.to, outputFaces, what + ": generated to");
  }
  using Key = std::tuple<int, int, int>;
  const auto ordered = [&](const std::vector<Key>& keys, const std::string& list) {
    for (std::size_t i = 1; i < keys.size(); ++i) {
      EXPECT_LT(keys[i - 1], keys[i]) << what << ": " << list << " out of order at " << i;
    }
  };
  std::vector<Key> modified;
  for (const HistoryLink& l : history.modified)
    modified.emplace_back(l.input, kindOrder(l.from.type), l.from.index);
  std::vector<Key> deleted;
  for (const DeletedSubShape& d : history.deleted)
    deleted.emplace_back(d.input, kindOrder(d.sub.type), d.sub.index);
  std::vector<Key> generated;
  for (const HistoryLink& l : history.generated)
    generated.emplace_back(l.input, kindOrder(l.from.type), l.from.index);
  ordered(modified, "modified");
  ordered(deleted, "deleted");
  ordered(generated, "generated");
}

class History : public ::testing::Test {
 protected:
  ShapeHandle aBox() { return ok(kernel.makeBox(kBox)).shape; }

  /** Topologies of the inputs and the output, then the completeness check of spec 06. */
  void expectComplete(const ShapeResult& result, const std::vector<ShapeHandle>& inputs,
                      const std::string& what) {
    ASSERT_TRUE(result.history.has_value()) << what << ": no history";
    std::vector<TopologySummary> topologies;
    for (const ShapeHandle h : inputs) topologies.push_back(ok(kernel.topology(h)));
    expectCompleteHistory(*result.history, topologies, ok(kernel.topology(result.shape)), what);
  }

  OcctKernel kernel;
};

TEST_F(History, PrimitivesAndMakeFaceReturnNoHistory) {
  EXPECT_FALSE(ok(kernel.makeBox(kBox)).history.has_value());
  EXPECT_FALSE(ok(kernel.makeCylinder(kCylinder)).history.has_value());
  EXPECT_FALSE(ok(kernel.makeFace(square10())).history.has_value());
}

TEST_F(History, TransformHasEveryFaceOfTheInputExactlyOnce) {
  const ShapeHandle a = aBox();
  expectComplete(ok(kernel.transform(a, rotationAxisAngle({0, 0, 1}, kTurn / 8))), {a},
                 "transform");
}

TEST_F(History, BooleanHasEveryFaceOfEveryInputExactlyOnce) {
  for (const BooleanOp op : {BooleanOp::Union, BooleanOp::Subtract, BooleanOp::Intersect}) {
    const ShapeHandle a = aBox();
    const ShapeHandle b = ok(kernel.makeBox(kOverlapping)).shape;
    expectComplete(ok(kernel.boolean(op, std::span(&a, 1), std::span(&b, 1))), {a, b},
                   "boolean " + std::to_string(static_cast<int>(op)));
  }
}

TEST_F(History, ExtrudeHasEveryFaceOfTheProfileExactlyOnce) {
  const ShapeHandle profile = ok(kernel.makeFace(square10())).shape;
  expectComplete(ok(kernel.extrude(profile, {0, 0, 1}, 5)), {profile}, "extrude");
}

TEST_F(History, RevolveHasEveryFaceOfTheProfileExactlyOnce) {
  for (const double angle : {kTurn, kTurn / 4}) {
    const ShapeHandle profile = ok(kernel.makeFace(ringProfile())).shape;
    expectComplete(ok(kernel.revolve(profile, kZAxis, angle)), {profile},
                   "revolve " + std::to_string(angle));
  }
}

TEST_F(History, FilletAndChamferHaveEveryFaceOfTheInputExactlyOnce) {
  const int edge[] = {0};
  const ShapeHandle a = aBox();
  expectComplete(ok(kernel.fillet(a, edge, 0.5)), {a}, "fillet");
  expectComplete(ok(kernel.chamfer(a, edge, 0.5)), {a}, "chamfer");
}

// --- test/unit/kernel-occt/occt-history.test.ts -----------------------------------------------

/** Where face `index` of input `input` went: "deleted" or the modified faces. */
std::variant<std::string, std::vector<int>> fate(const ShapeHistory& history, int input,
                                                 int index) {
  for (const DeletedSubShape& d : history.deleted) {
    if (d.input == input && d.sub.index == index) return std::string("deleted");
  }
  std::vector<int> to;
  for (const HistoryLink& l : history.modified) {
    if (l.input != input || l.from.index != index) continue;
    for (const SubShapeIndex& s : l.to) to.push_back(s.index);
  }
  return to;
}

/** The single face that face `index` of input `input` became; -1 and a failure otherwise. */
int onlyTarget(const ShapeHistory& history, int input, int index) {
  const auto to = fate(history, input, index);
  if (!std::holds_alternative<std::vector<int>>(to) || std::get<std::vector<int>>(to).size() != 1) {
    ADD_FAILURE() << "face " << index << " of input " << input << " has no single target";
    return -1;
  }
  return std::get<std::vector<int>>(to).front();
}

TEST_F(History, ABoxMinusACylinderThroughItKeepsTheLateralFaceAndDeletesTheCaps) {
  const ShapeResult box = ok(kernel.makeBox({{0, 0, 0}, {20, 20, 10}}));
  const ShapeResult cylinder = ok(kernel.makeCylinder({{10, 10, -1}, {0, 0, 1}, 3, 12}));
  const ShapeResult cut = ok(
      kernel.boolean(BooleanOp::Subtract, std::span(&box.shape, 1), std::span(&cylinder.shape, 1)));
  const TopologySummary topology = ok(kernel.topology(cut.shape));
  ASSERT_EQ(topology.faces.size(), 7U);
  const ShapeHistory& history = *cut.history;

  const int hole = onlyTarget(history, 1, roleIndex(cylinder.roles, "face:side"));
  ASSERT_GE(hole, 0);
  EXPECT_EQ(topology.faces[static_cast<std::size_t>(hole)].surface, SurfaceType::Cylinder);

  const int topOut = onlyTarget(history, 0, roleIndex(box.roles, "face:top"));
  const int bottomOut = onlyTarget(history, 0, roleIndex(box.roles, "face:bottom"));
  ASSERT_GE(topOut, 0);
  ASSERT_GE(bottomOut, 0);
  EXPECT_NEAR(topology.faces[static_cast<std::size_t>(topOut)].plane->normal[2], 1, 1e-9);
  EXPECT_NEAR(topology.faces[static_cast<std::size_t>(bottomOut)].plane->normal[2], -1, 1e-9);

  EXPECT_EQ(fate(history, 1, roleIndex(cylinder.roles, "face:top")),
            (std::variant<std::string, std::vector<int>>(std::string("deleted"))));
  EXPECT_EQ(fate(history, 1, roleIndex(cylinder.roles, "face:bottom")),
            (std::variant<std::string, std::vector<int>>(std::string("deleted"))));

  // The circle where the hole meets the top face is an edge between those two faces.
  const std::vector<int> between{std::min(hole, topOut), std::max(hole, topOut)};
  EXPECT_TRUE(std::any_of(topology.edges.begin(), topology.edges.end(),
                          [&](const EdgeInfo& e) { return e.faces == between; }));
}

TEST_F(History, ATransformMapsEveryFaceOntoItsMovedSelfInTheSameOrder) {
  const ShapeHandle box = ok(kernel.makeBox({{0, 0, 0}, {1, 2, 3}})).shape;
  const ShapeResult moved = ok(kernel.transform(box, translation({5, 0, 0})));
  ASSERT_TRUE(moved.history.has_value());
  ASSERT_EQ(moved.history->modified.size(), 6U);
  for (int i = 0; i < 6; ++i) {
    const HistoryLink& link = moved.history->modified[static_cast<std::size_t>(i)];
    EXPECT_EQ(link.input, 0);
    EXPECT_EQ(link.from, (SubShapeIndex{SubShapeType::Face, i}));
    EXPECT_EQ(link.to, (std::vector<SubShapeIndex>{{SubShapeType::Face, i}}));
  }
  EXPECT_TRUE(moved.history->generated.empty());
  EXPECT_TRUE(moved.history->deleted.empty());
}

TEST_F(History, AnExtrudeGeneratesTheSideFacesFromTheProfileEdges) {
  const ShapeHandle profile = ok(kernel.makeFace(faceOf(kPlaneXY, {circle({0, 0}, 1)}))).shape;
  const ShapeResult prism = ok(kernel.extrude(profile, {0, 0, 1}, 2));
  std::vector<HistoryLink> fromEdges;
  for (const HistoryLink& l : prism.history->generated) {
    if (l.from.type == SubShapeType::Edge) fromEdges.push_back(l);
  }
  ASSERT_EQ(fromEdges.size(), 1U);
  EXPECT_EQ(fromEdges[0].to.size(), 1U);
}

// --- HistoryCollector directly over OCCT -------------------------------------------------------

TEST(HistoryCollector, CollectsTheHistoryOfAFuseOfTwoBoxes) {
  using detail::ShapeEntry;
  BRepPrimAPI_MakeBox first(gp_Pnt(0, 0, 0), 2, 2, 2);
  BRepPrimAPI_MakeBox second(gp_Pnt(1, 1, 1), 2, 2, 2);
  const ShapeEntry a(first.Shape());
  const ShapeEntry b(second.Shape());
  BRepAlgoAPI_Fuse fuse(a.shape(), b.shape());
  ASSERT_TRUE(fuse.IsDone());
  const ShapeEntry output(fuse.Shape());
  detail::HistoryCollector collector(fuse, output);
  const ShapeHistory history = collector.collect({&a, &b});

  // Each box keeps 3 faces whole (identity or modified) and has 3 faces cut by the other box:
  // every one of its 6 faces is there exactly once, none deleted, all in the 12 output faces.
  ASSERT_EQ(output.faces().Extent(), 12);
  EXPECT_EQ(history.modified.size(), 12U);
  EXPECT_TRUE(history.deleted.empty());
  for (std::size_t i = 0; i < history.modified.size(); ++i) {
    const HistoryLink& link = history.modified[i];
    EXPECT_EQ(link.input, static_cast<int>(i / 6));
    EXPECT_EQ(link.from.index, static_cast<int>(i % 6));
    ASSERT_EQ(link.to.size(), 1U);
    EXPECT_LT(link.to[0].index, 12);
  }
  // Two boxes fused: no face is generated from an edge or a vertex of the inputs.
  EXPECT_TRUE(history.generated.empty());
}

}  // namespace
}  // namespace tinycad::kernel
