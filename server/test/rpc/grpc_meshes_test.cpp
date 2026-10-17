// Meshes by version through a real gRPC channel (spec 14 "Read model a sítě", "Testy"; Q100,
// N43, N60): the first read model carries every mesh, known versions none, a change of one body
// only its mesh, and after a server restart new versions, so the client downloads them again.

#include <gtest/gtest.h>

#include "rpc/grpc_harness.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class GrpcMeshesTest : public ::testing::Test {
 protected:
  TestServer server;
  document::DocumentId part = server.createDocument("Part");
  std::string session = server.openOk(part);

  void SetUp() override {
    ASSERT_TRUE(server.dispatch(session, addBox("a", 0), "op-a").ok());
    ASSERT_TRUE(server.dispatch(session, addBox("b", 1), "op-b").ok());
  }
};

TEST_F(GrpcMeshesTest, TheFirstReadModelCarriesEveryMesh) {
  auto read = server.readModel(session);
  ASSERT_TRUE(read.ok());
  const auto meshes = meshesOf(read.response.read_model());
  ASSERT_EQ(meshes.size(), 2U);
  for (const auto& [version, hasMesh] : meshes) {
    EXPECT_FALSE(version.empty());
    EXPECT_TRUE(hasMesh) << version;
  }
  EXPECT_NE(meshes[0].first, meshes[1].first);
}

TEST_F(GrpcMeshesTest, KnownMeshesWithEveryVersionGiveNoMesh) {
  const v1::ReadModel first = server.readModel(session).response.read_model();
  auto again = server.readModel(session, knowing(first));
  ASSERT_TRUE(again.ok());
  for (const auto& [version, hasMesh] : meshesOf(again.response.read_model())) {
    EXPECT_FALSE(hasMesh) << version;
  }
}

TEST_F(GrpcMeshesTest, AChangeOfOneBodySendsOnlyItsMesh) {
  const v1::ReadModel first = server.readModel(session).response.read_model();
  auto changed = server.dispatch(session, setWidth("b", 25), "op-w", knowing(first));
  ASSERT_TRUE(changed.ok());
  const auto before = meshesOf(first);
  const auto after = meshesOf(changed.response.result().read_model());
  ASSERT_EQ(after.size(), 2U);
  EXPECT_EQ(after[0].first, before[0].first);
  EXPECT_FALSE(after[0].second);
  EXPECT_NE(after[1].first, before[1].first);
  EXPECT_TRUE(after[1].second);
}

TEST_F(GrpcMeshesTest, AfterARestartTheVersionsAreNewAndEveryMeshComesAgain) {
  const v1::ReadModel first = server.readModel(session).response.read_model();
  server.restart();
  const std::string fresh = server.openOk(part);
  auto read = server.readModel(fresh, knowing(first));
  ASSERT_TRUE(read.ok());
  const auto before = meshesOf(first);
  const auto after = meshesOf(read.response.read_model());
  ASSERT_EQ(after.size(), 2U);
  for (std::size_t i = 0; i < after.size(); ++i) {
    EXPECT_NE(after[i].first, before[i].first);
    EXPECT_TRUE(after[i].second);
  }
}

}  // namespace
}  // namespace tinycad::session
