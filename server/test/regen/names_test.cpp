// propagateNames on hand-built topologies and histories (spec 08; port of
// test/unit/regen/names.test.ts): no kernel needed.

#include "tinycad/regen/names.hpp"

#include <gtest/gtest.h>

#include <algorithm>

#include "regen/testing.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::regen::test {
namespace {

using kernel::EdgeInfo;
using kernel::FaceInfo;
using kernel::HistoryLink;
using kernel::ShapeHistory;
using kernel::SubShapeIndex;
using kernel::SubShapeType;
using kernel::TopologySummary;

TopoName tn(const std::string& s) { return TopoName(s); }
SubShapeIndex face(int i) { return {SubShapeType::Face, i}; }
SubShapeIndex edge(int i) { return {SubShapeType::Edge, i}; }
SubShapeIndex vertex(int i) { return {SubShapeType::Vertex, i}; }
const FaceInfo kPlane{kernel::SurfaceType::Plane, kernel::FacePlane{{0, 0, 0}, {0, 0, 1}}};

EdgeInfo anEdge(std::vector<int> faces, std::vector<int> vertices, core::Vec3 midpoint) {
  return EdgeInfo{std::move(faces), std::move(vertices), midpoint};
}

/**
 * An axis-aligned box: left 0 (−X), right 1 (+X), front 2 (−Y), back 3 (+Y), bottom 4 (−Z),
 * top 5 (+Z). Vertex v = x + 2y + 4z for the corner (x, y, z) ∈ {0, 1}³.
 */
TopologySummary boxTopology() {
  const auto facesOf = [](int v) {
    return std::vector<int>{v & 1 ? 1 : 0, v & 2 ? 3 : 2, v & 4 ? 5 : 4};
  };
  const auto corner = [](int v) {
    return core::Vec3{double(v & 1), double((v >> 1) & 1), double((v >> 2) & 1)};
  };
  TopologySummary t;
  t.faces.assign(6, kPlane);
  t.vertexCount = 8;
  for (int a = 0; a < 8; ++a) {
    for (int bit : {1, 2, 4}) {
      if (a & bit) continue;
      const int b = a | bit;
      std::vector<int> shared;
      for (int f : facesOf(a)) {
        const auto fb = facesOf(b);
        if (std::find(fb.begin(), fb.end(), f) != fb.end()) shared.push_back(f);
      }
      std::sort(shared.begin(), shared.end());
      const auto ca = corner(a);
      const auto cb = corner(b);
      t.edges.push_back(
          anEdge(shared, {a, b}, {(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2}));
    }
  }
  return t;
}

kernel::Roles boxRoles() {
  return {{"face:left", {face(0)}}, {"face:right", {face(1)}},  {"face:front", {face(2)}},
          {"face:back", {face(3)}}, {"face:bottom", {face(4)}}, {"face:top", {face(5)}}};
}

NamingInput naming(const std::string& feature, std::vector<NameTablePtr> inputs,
                   TopologySummary topology, kernel::Roles roles = {},
                   std::optional<ShapeHistory> history = std::nullopt, std::string tag = "gen") {
  return NamingInput{fid(feature),     std::move(inputs),   std::move(history),
                     std::move(roles), std::move(topology), std::move(tag)};
}

NameTablePtr aBoxTable(const std::string& id = "box") {
  return propagateNames(naming(id, {}, boxTopology(), boxRoles()));
}

std::vector<HistoryLink> identity(int input, int count) {
  std::vector<HistoryLink> links;
  for (int i = 0; i < count; ++i) links.push_back(HistoryLink{input, face(i), {face(i)}});
  return links;
}

TopologySummary facesOnly(int n) {
  TopologySummary t;
  t.faces.assign(static_cast<std::size_t>(n), kPlane);
  return t;
}

std::vector<std::string> keys(const std::map<TopoName, std::vector<int>>& entries) {
  std::vector<std::string> out;
  for (const auto& [name, indices] : entries) out.push_back(name.str());
  return out;
}

std::string nameOr(const std::optional<TopoName>& name) { return name ? name->str() : "<none>"; }

// --- roles

TEST(PropagateNamesRoles, NamesBoxFacesByRoleAndEdgesByTheirTwoFaces) {
  const auto t = aBoxTable();
  EXPECT_EQ(keys(t->faceEntries()),
            (std::vector<std::string>{"box/face:back", "box/face:bottom", "box/face:front",
                                      "box/face:left", "box/face:right", "box/face:top"}));
  EXPECT_EQ(nameOr(t->nameOfFace(5)), "box/face:top");
  EXPECT_EQ(t->faces(tn("box/face:top")), std::vector<int>{5});
  EXPECT_EQ(t->edgeEntries().size(), 12U);
  for (const auto& name : keys(t->edgeEntries())) {
    EXPECT_TRUE(name.starts_with("edge:box/face:")) << name;
    EXPECT_EQ(std::count(name.begin(), name.end(), '|'), 1) << name;
  }
  // Edge 0 joins corners 0 and 1: front (−Y) and bottom (−Z); A ≤ B in sort order.
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:box/face:bottom|box/face:front");
  EXPECT_EQ(t->edges(*t->nameOfEdge(0)), std::vector<int>{0});
}

TEST(PropagateNamesRoles, IgnoresRoleKeysThatAreNotFaces) {
  const auto t = propagateNames(
      naming("f", {}, facesOnly(1), {{"edge:l1", {edge(0)}}, {"face:start", {face(0)}}}));
  EXPECT_EQ(keys(t->faceEntries()), std::vector<std::string>{"f/face:start"});
  EXPECT_TRUE(t->edgeEntries().empty());
}

TEST(PropagateNamesRoles, GivesOneRoleNameToAllFacesOfTheRole) {
  const auto t = propagateNames(naming("f", {}, facesOnly(3), {{"face:end", {face(2), face(0)}}}));
  EXPECT_EQ(t->faces(tn("f/face:end")), (std::vector<int>{0, 2}));
  EXPECT_FALSE(t->nameOfFace(1).has_value());
}

// --- history

TEST(PropagateNamesHistory, KeepsNamesThroughAnIdentityHistory) {
  const auto box = aBoxTable();
  const auto moved = propagateNames(
      naming("move", {box}, boxTopology(), {}, ShapeHistory{identity(0, 6), {}, {}}));
  EXPECT_EQ(moved->faceEntries(), box->faceEntries());
  EXPECT_EQ(moved->edgeEntries(), box->edgeEntries());
}

TEST(PropagateNamesHistory, GivesASplitFaceItsNameOnBothOutputFaces) {
  const auto input = propagateNames(naming("a", {}, facesOnly(1), {{"face:x", {face(0)}}}));
  const auto t =
      propagateNames(naming("cut", {input}, facesOnly(2), {},
                            ShapeHistory{{HistoryLink{0, face(0), {face(0), face(1)}}}, {}, {}}));
  EXPECT_EQ(t->faces(tn("a/face:x")), (std::vector<int>{0, 1}));
  EXPECT_EQ(nameOr(t->nameOfFace(1)), "a/face:x");
}

TEST(PropagateNamesHistory, KeepsAllNamesOnAMergedFacePrimaryFirstBySortOrder) {
  const auto a = propagateNames(naming("a", {}, facesOnly(1), {{"face:z", {face(0)}}}));
  const auto b = propagateNames(naming("b", {}, facesOnly(1), {{"face:y", {face(0)}}}));
  const auto t = propagateNames(naming(
      "u", {a, b}, facesOnly(1), {},
      ShapeHistory{
          {HistoryLink{0, face(0), {face(0)}}, HistoryLink{1, face(0), {face(0)}}}, {}, {}}));
  EXPECT_EQ(t->namesOfFace(0), (std::vector<TopoName>{tn("a/face:z"), tn("b/face:y")}));
  EXPECT_EQ(nameOr(t->nameOfFace(0)), "a/face:z");
  EXPECT_EQ(t->faces(tn("b/face:y")), std::vector<int>{0});
}

TEST(PropagateNamesHistory, DropsTheNameOfADeletedFace) {
  const auto box = aBoxTable();
  const auto t = propagateNames(
      naming("cut", {box}, facesOnly(5), {},
             ShapeHistory{identity(0, 5), {}, {kernel::DeletedSubShape{0, face(5)}}}));
  EXPECT_TRUE(t->faces(tn("box/face:top")).empty());
  EXPECT_FALSE(t->faceEntries().contains(tn("box/face:top")));
  EXPECT_EQ(t->faceEntries().size(), 5U);
}

TEST(PropagateNamesHistory, NamesAFaceGeneratedFromAnEdgeByTagAndEdgeName) {
  const auto box = aBoxTable();
  const auto t = propagateNames(
      naming("fil", {box}, facesOnly(7), {},
             ShapeHistory{identity(0, 6), {HistoryLink{0, edge(0), {face(6)}}}, {}}, "fillet"));
  EXPECT_EQ(nameOr(t->nameOfFace(6)), "fil/face:fillet:" + box->nameOfEdge(0)->str());
  EXPECT_EQ(nameOr(t->nameOfFace(6)), "fil/face:fillet:edge:box/face:bottom|box/face:front");
}

TEST(PropagateNamesHistory, NamesAFaceGeneratedFromAVertexByTheFacesAroundIt) {
  const auto box = aBoxTable();
  const auto t = propagateNames(
      naming("fil", {box}, facesOnly(7), {},
             ShapeHistory{identity(0, 6), {HistoryLink{0, vertex(0), {face(6)}}}, {}}, "fillet"));
  // Corner 0 = (0, 0, 0): left, front, bottom.
  EXPECT_EQ(nameOr(t->nameOfFace(6)),
            "fil/face:fillet:vertex:box/face:bottom|box/face:front|box/face:left");
}

TEST(PropagateNamesHistory, NamesAFaceGeneratedFromAFaceWithTheDefaultTag) {
  const auto box = aBoxTable();
  const auto t = propagateNames(
      naming("b", {box}, facesOnly(7), {},
             ShapeHistory{identity(0, 6), {HistoryLink{0, face(5), {face(6)}}}, {}}));
  EXPECT_EQ(nameOr(t->nameOfFace(6)), "b/face:gen:box/face:top");
}

TEST(PropagateNamesHistory, SkipsAGeneratedSourceWithoutAName) {
  const auto t = propagateNames(
      naming("ex", {NameTable::empty()}, facesOnly(1), {},
             ShapeHistory{
                 {}, {HistoryLink{0, edge(3), {face(0)}}}, {kernel::DeletedSubShape{0, face(0)}}}));
  EXPECT_FALSE(t->nameOfFace(0).has_value());
  EXPECT_TRUE(t->namesOfFace(0).empty());
  EXPECT_TRUE(t->faceEntries().empty());
}

TEST(PropagateNamesHistory, GivesTheRolePrecedenceOverGenerated) {
  const auto box = aBoxTable();
  const auto t = propagateNames(
      naming("ex", {box}, facesOnly(7), {{"face:side:l1", {face(6)}}},
             ShapeHistory{identity(0, 6), {HistoryLink{0, edge(0), {face(6)}}}, {}}));
  EXPECT_EQ(t->namesOfFace(6), std::vector<TopoName>{tn("ex/face:side:l1")});
}

TEST(PropagateNamesHistory, LeavesAFaceWithoutHistoryAndRoleWithoutAName) {
  const auto t = propagateNames(naming("f", {}, facesOnly(2)));
  EXPECT_FALSE(t->nameOfFace(0).has_value());
  EXPECT_FALSE(t->nameOfFace(7).has_value());
  EXPECT_TRUE(t->namesOfFace(7).empty());
}

// --- edges

/**
 * Two faces A (0) and B (1) joined by two edges, like a cylinder side cut by a plane twice. Faces
 * C (2) and D (3) touch the ends of edge 0, E (4) the ends of edge 1.
 */
NameTablePtr twoEdgesBetween(kernel::Roles roles, core::Vec3 m0, core::Vec3 m1) {
  TopologySummary t;
  t.faces.assign(5, kPlane);
  t.edges = {anEdge({0, 1}, {0, 1}, m0),     anEdge({0, 1}, {2, 3}, m1),
             anEdge({0, 2}, {0}, {0, 0, 0}), anEdge({1, 3}, {1}, {0, 0, 0}),
             anEdge({0, 4}, {2}, {0, 0, 0}), anEdge({1, 4}, {3}, {0, 0, 0})};
  t.vertexCount = 4;
  return propagateNames(naming("f", {}, t, std::move(roles)));
}

TEST(PropagateNamesEdges, TellsTwoEdgesBetweenTheSameFacesApartByTheFacesAroundTheirVertices) {
  const auto t = twoEdgesBetween({{"face:a", {face(0)}},
                                  {"face:b", {face(1)}},
                                  {"face:c", {face(2)}},
                                  {"face:d", {face(3)}},
                                  {"face:e", {face(4)}}},
                                 {0, 0, 0}, {1, 0, 0});
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:f/face:a|f/face:b[f/face:c,f/face:d]");
  EXPECT_EQ(nameOr(t->nameOfEdge(1)), "edge:f/face:a|f/face:b[f/face:e]");
  EXPECT_EQ(nameOr(t->nameOfEdge(2)), "edge:f/face:a|f/face:c");
}

TEST(PropagateNamesEdges, NumbersEdgesWithTheSameContextByTheirMidpoint) {
  const auto t = twoEdgesBetween(
      {{"face:a", {face(0)}}, {"face:b", {face(1)}}, {"face:c", {face(2), face(3), face(4)}}},
      {0, 5, 0}, {0, 1, 0});
  EXPECT_EQ(nameOr(t->nameOfEdge(1)), "edge:f/face:a|f/face:b[f/face:c]#1");
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:f/face:a|f/face:b[f/face:c]#2");
}

TEST(PropagateNamesEdges, FallsBackToTheIndexWhenMidpointsMatchWithin1e9) {
  const auto t = twoEdgesBetween(
      {{"face:a", {face(0)}}, {"face:b", {face(1)}}, {"face:c", {face(2), face(3), face(4)}}},
      {1, 1, 1}, {1, 1 - 1e-12, 1});
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:f/face:a|f/face:b[f/face:c]#1");
  EXPECT_EQ(nameOr(t->nameOfEdge(1)), "edge:f/face:a|f/face:b[f/face:c]#2");
}

TEST(PropagateNamesEdges, WritesAnEmptyContextAsBrackets) {
  TopologySummary topology;
  topology.faces = {kPlane, kPlane};
  topology.edges = {anEdge({0, 1}, {0}, {0, 0, 0}), anEdge({0, 1}, {1}, {1, 0, 0})};
  topology.vertexCount = 2;
  const auto t =
      propagateNames(naming("f", {}, topology, {{"face:a", {face(0)}}, {"face:b", {face(1)}}}));
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:f/face:a|f/face:b[]#1");
  EXPECT_EQ(nameOr(t->nameOfEdge(1)), "edge:f/face:a|f/face:b[]#2");
}

TEST(PropagateNamesEdges, NamesASeamWithOneAdjacentFace) {
  TopologySummary topology;
  topology.faces = {kPlane};
  topology.edges = {anEdge({0}, {0}, {0, 0, 0})};
  topology.vertexCount = 1;
  const auto t = propagateNames(naming("c", {}, topology, {{"face:side", {face(0)}}}));
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:c/face:side|c/face:side");
}

TEST(PropagateNamesEdges, LeavesAnEdgeNextToAnUnnamedFaceWithoutAName) {
  TopologySummary topology;
  topology.faces = {kPlane, kPlane};
  topology.edges = {anEdge({0, 1}, {0, 1}, {0, 0, 0})};
  topology.vertexCount = 2;
  const auto t = propagateNames(naming("f", {}, topology, {{"face:a", {face(0)}}}));
  EXPECT_FALSE(t->nameOfEdge(0).has_value());
  EXPECT_TRUE(t->edgeEntries().empty());
}

TEST(PropagateNamesEdges, UsesThePrimaryNameOfAMergedFace) {
  const auto a =
      propagateNames(naming("a", {}, facesOnly(2), {{"face:p", {face(0)}}, {"face:q", {face(1)}}}));
  TopologySummary topology;
  topology.faces = {kPlane};
  topology.edges = {anEdge({0}, {}, {0, 0, 0})};
  const auto t = propagateNames(naming(
      "u", {a}, topology, {},
      ShapeHistory{
          {HistoryLink{0, face(0), {face(0)}}, HistoryLink{0, face(1), {face(0)}}}, {}, {}}));
  EXPECT_EQ(nameOr(t->nameOfEdge(0)), "edge:a/face:p|a/face:p");
}

// --- determinism and errors

TEST(PropagateNamesDeterminism, GivesTheSameTableForAnotherOrderOfHistoryAndRoles) {
  const auto box = aBoxTable();
  const std::vector<HistoryLink> generated{HistoryLink{0, edge(0), {face(6)}},
                                           HistoryLink{0, vertex(0), {face(7)}}};
  const auto one = propagateNames(naming("f", {box}, facesOnly(9),
                                         {{"face:z", {face(8)}}, {"face:a", {face(6)}}},
                                         ShapeHistory{identity(0, 6), generated, {}}));
  auto modified = identity(0, 6);
  std::reverse(modified.begin(), modified.end());
  auto reversed = generated;
  std::reverse(reversed.begin(), reversed.end());
  const auto two = propagateNames(naming("f", {box}, facesOnly(9),
                                         {{"face:a", {face(6)}}, {"face:z", {face(8)}}},
                                         ShapeHistory{modified, reversed, {}}));
  EXPECT_EQ(two->faceEntries(), one->faceEntries());
  auto sorted = keys(one->faceEntries());
  std::sort(sorted.begin(), sorted.end());
  EXPECT_EQ(keys(two->faceEntries()), sorted);
}

TEST(PropagateNamesErrors, ThrowsOnARoleIndexOutOfTheOutputRange) {
  EXPECT_THROW(propagateNames(naming("f", {}, facesOnly(3), {{"face:x", {face(3)}}})),
               core::AssertionError);
}

TEST(PropagateNamesErrors, ThrowsOnAHistoryIndexOutOfTheOutputRange) {
  EXPECT_THROW(propagateNames(naming("f", {aBoxTable()}, facesOnly(6), {},
                                     ShapeHistory{{HistoryLink{0, face(0), {face(6)}}}, {}, {}})),
               core::AssertionError);
}

TEST(PropagateNamesErrors, ThrowsOnAHistoryIndexOutOfTheInputRange) {
  EXPECT_THROW(propagateNames(naming("f", {aBoxTable()}, facesOnly(6), {},
                                     ShapeHistory{{}, {}, {kernel::DeletedSubShape{0, face(6)}}})),
               core::AssertionError);
  EXPECT_THROW(propagateNames(naming("f", {aBoxTable()}, facesOnly(6), {},
                                     ShapeHistory{{}, {HistoryLink{0, vertex(8), {face(0)}}}, {}})),
               core::AssertionError);
}

TEST(PropagateNamesErrors, ThrowsOnAnUnknownInput) {
  EXPECT_THROW(propagateNames(naming("f", {aBoxTable()}, facesOnly(6), {},
                                     ShapeHistory{{HistoryLink{1, face(0), {face(0)}}}, {}, {}})),
               core::AssertionError);
}

TEST(PropagateNamesErrors, ThrowsOnAnEdgeFaceIndexOutOfTheOutputRange) {
  TopologySummary topology;
  topology.faces = {kPlane};
  topology.edges = {anEdge({0, 1}, {}, {0, 0, 0})};
  EXPECT_THROW(propagateNames(naming("f", {}, topology)), core::AssertionError);
}

TEST(EmptyNames, HasNoNamesAndAnEmptyTopology) {
  const auto& e = NameTable::empty();
  EXPECT_TRUE(e->faceEntries().empty());
  EXPECT_TRUE(e->edgeEntries().empty());
  EXPECT_TRUE(e->topology().faces.empty());
  EXPECT_TRUE(e->topology().edges.empty());
  EXPECT_EQ(e->topology().vertexCount, 0);
  EXPECT_FALSE(e->nameOfFace(0).has_value());
  EXPECT_FALSE(e->nameOfEdge(0).has_value());
  EXPECT_TRUE(e->namesOfFace(0).empty());
  EXPECT_TRUE(e->faces(tn("x")).empty());
  EXPECT_TRUE(e->edges(tn("x")).empty());
  EXPECT_EQ(NameTable::empty(), e);
}

TEST(NameTableConstruction, RejectsSizesThatDoNotMatchTheTopology) {
  EXPECT_THROW(NameTable({{}}, {}, TopologySummary{}), core::AssertionError);
  EXPECT_THROW(NameTable({}, {std::nullopt}, TopologySummary{}), core::AssertionError);
}

}  // namespace
}  // namespace tinycad::regen::test
