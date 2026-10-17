// tinycad-core: the gRPC server of the native core (ADR 0030, spec 14). Listens on
// TINYCAD_CORE_ADDRESS (0.0.0.0:50051 by default) with the standard health service
// (grpc.health.v1, used by Envoy) and shuts down gracefully on SIGTERM or SIGINT: no new calls,
// the calls in flight get a few seconds to finish.

#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>

#include <chrono>
#include <pthread.h>
#include <signal.h>

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <random>
#include <sstream>
#include <string>

#include "tinycad/service/geometry_service.hpp"

namespace {

constexpr auto kShutdownGrace = std::chrono::seconds(5);

/**
 * The epoch of this server process: a random id that changes with every start. Later
 * milestones hand it to clients so they notice a restart (sessions and mesh versions are lost).
 */
std::string makeEpoch() {
  std::random_device device;
  std::mt19937_64 engine(device());
  std::ostringstream text;
  text << std::hex << engine();
  return text.str();
}

std::string listenAddress() {
  const char* value = std::getenv("TINYCAD_CORE_ADDRESS");
  return value != nullptr && *value != '\0' ? value : "0.0.0.0:50051";
}

}  // namespace

int main() {
  // Block the shutdown signals before gRPC starts its threads, so that only sigwait below
  // receives them.
  sigset_t signals;
  sigemptyset(&signals);
  sigaddset(&signals, SIGTERM);
  sigaddset(&signals, SIGINT);
  pthread_sigmask(SIG_BLOCK, &signals, nullptr);

  const std::string epoch = makeEpoch();
  const std::string address = listenAddress();

  tinycad::service::GeometryServiceImpl geometry;
  grpc::EnableDefaultHealthCheckService(true);
  grpc::ServerBuilder builder;
  builder.AddListeningPort(address, grpc::InsecureServerCredentials());
  builder.RegisterService(&geometry);
  const std::unique_ptr<grpc::Server> server = builder.BuildAndStart();
  if (!server) {
    std::cerr << "tinycad-core: cannot listen on " << address << '\n';
    return EXIT_FAILURE;
  }
  server->GetHealthCheckService()->SetServingStatus("tinycad.v1.GeometryService", true);
  std::cout << "tinycad-core listening on " << address << ", epoch " << epoch << std::endl;

  int received = 0;
  sigwait(&signals, &received);
  std::cout << "tinycad-core: signal " << received << ", shutting down" << std::endl;
  server->GetHealthCheckService()->Shutdown();
  server->Shutdown(std::chrono::system_clock::now() + kShutdownGrace);
  server->Wait();
  return EXIT_SUCCESS;
}
