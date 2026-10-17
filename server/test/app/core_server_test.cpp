// A smoke test of the composed server (CoreServer, M45 task 5): it listens on a free port with
// the health of all three services, serves DocumentService over the data directory, keeps the
// documents across a restart, and shuts down while a call could still come.

#include "core_server.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <random>
#include <string>

#include <grpcpp/generic/generic_stub.h>

#include <vector>

#include "tinycad/v1/session.grpc.pb.h"

namespace tinycad::app {
namespace {

namespace v1 = tinycad::v1;

/** grpc.health.v1.HealthCheckResponse.ServingStatus.SERVING */
constexpr int SERVING = 1;

/**
 * grpc.health.v1.Health/Check of `service`: its status, or -1 when the call fails. vcpkg's gRPC
 * ships no generated health stubs, so the two tiny messages are encoded by hand: the request is
 * field 1 (string service), the response field 1 (enum status, one varint byte).
 */
int healthOf(const std::shared_ptr<grpc::Channel>& channel, const std::string& service) {
  const std::string bytes = std::string("\x0a") + static_cast<char>(service.size()) + service;
  grpc::Slice slice(bytes);
  const grpc::ByteBuffer request(&slice, 1);
  grpc::GenericStub stub(channel);
  grpc::ClientContext context;
  grpc::CompletionQueue queue;
  const auto call =
      stub.PrepareUnaryCall(&context, "/grpc.health.v1.Health/Check", request, &queue);
  call->StartCall();
  grpc::ByteBuffer reply;
  grpc::Status status;
  call->Finish(&reply, &status, nullptr);
  void* tag = nullptr;
  bool ok = false;
  if (!queue.Next(&tag, &ok) || !ok || !status.ok()) return -1;
  std::vector<grpc::Slice> slices;
  if (!reply.Dump(&slices).ok()) return -1;
  std::string text;
  for (const grpc::Slice& part : slices) {
    // Slice bytes are uint8_t; the message is compared as chars.
    text.append(reinterpret_cast<const char*>(part.begin()), part.size());
  }
  return text.size() == 2 && text[0] == '\x08' ? text[1] : 0;
}

class CoreServerTest : public ::testing::Test {
 protected:
  CoreServerTest() {
    std::random_device random;
    dir = std::filesystem::temp_directory_path() / ("tinycad-app-" + std::to_string(random()));
    config.address = "127.0.0.1:0";
    config.dataDir = dir;
  }
  ~CoreServerTest() override {
    std::error_code ignored;
    std::filesystem::remove_all(dir, ignored);
  }

  std::shared_ptr<grpc::Channel> channelTo(const CoreServer& server) const {
    return grpc::CreateChannel("127.0.0.1:" + std::to_string(server.port()),
                               grpc::InsecureChannelCredentials());
  }

  std::filesystem::path dir;
  CoreConfig config;
};

TEST_F(CoreServerTest, AllThreeServicesAreHealthy) {
  const auto server = CoreServer::start(config);
  ASSERT_NE(server, nullptr);
  EXPECT_GT(server->port(), 0);
  const auto channel = channelTo(*server);
  for (const char* service : {"", "tinycad.v1.GeometryService", "tinycad.v1.SessionService",
                              "tinycad.v1.DocumentService"}) {
    EXPECT_EQ(healthOf(channel, service), SERVING) << service;
  }
}

TEST_F(CoreServerTest, ADocumentCreatedThroughTheServerSurvivesARestart) {
  std::string id;
  {
    const auto server = CoreServer::start(config);
    ASSERT_NE(server, nullptr);
    const auto documents = v1::DocumentService::NewStub(channelTo(*server));
    grpc::ClientContext context;
    v1::CreateDocumentRequest request;
    request.set_operation_id("op-1");
    request.set_name("Part");
    v1::CreateDocumentResponse response;
    ASSERT_TRUE(documents->CreateDocument(&context, request, &response).ok());
    id = response.document().document_id();
    EXPECT_EQ(id.size(), 36U);  // UUID v4
    server->shutdown();
  }
  const auto server = CoreServer::start(config);
  ASSERT_NE(server, nullptr);
  const auto documents = v1::DocumentService::NewStub(channelTo(*server));
  grpc::ClientContext context;
  v1::ListDocumentsResponse listed;
  ASSERT_TRUE(documents->ListDocuments(&context, {}, &listed).ok());
  ASSERT_EQ(listed.documents_size(), 1);
  EXPECT_EQ(listed.documents(0).document_id(), id);
  EXPECT_EQ(listed.documents(0).name(), "Part");
}

TEST_F(CoreServerTest, AnAddressThatCannotBeBoundGivesNoServer) {
  config.address = "256.0.0.1:1";
  EXPECT_EQ(CoreServer::start(config), nullptr);
}

}  // namespace
}  // namespace tinycad::app
