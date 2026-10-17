// tinycad-core: the gRPC server of the native core (ADR 0030, spec 14). Reads the environment,
// quiets the info messages of OCCT, starts the composed server (core_server.hpp) and shuts it
// down gracefully on SIGTERM or SIGINT.
//
// Environment (decision N61):
//   TINYCAD_CORE_ADDRESS          listen address, default 0.0.0.0:50051
//   TINYCAD_DATA_DIR              the document catalog (one SQLite file per document), default /data
//   TINYCAD_SESSION_IDLE_SECONDS  idle timeout of a session, default 600

#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Message_Printer.hxx>
#include <pthread.h>
#include <signal.h>

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>

#include "core_server.hpp"

namespace {

std::string environment(const char* name, const std::string& fallback) {
  const char* value = std::getenv(name);
  return value != nullptr && *value != '\0' ? value : fallback;
}

/** TINYCAD_SESSION_IDLE_SECONDS; a missing or unusable value keeps the default of 600 s. */
std::chrono::seconds idleTimeout() {
  const std::string text = environment("TINYCAD_SESSION_IDLE_SECONDS", "600");
  try {
    const long seconds = std::stol(text);
    if (seconds > 0) return std::chrono::seconds(seconds);
  } catch (const std::exception&) {
  }
  std::cerr << "tinycad-core: TINYCAD_SESSION_IDLE_SECONDS '" << text << "' ignored, using 600\n";
  return std::chrono::seconds(600);
}

/**
 * Decision N78: OCCT reports every STEP transfer and write ("Statistics on Transfer", "Write
 * Done") as info messages of the process-wide default messenger, which prints them to stdout.
 * Raised once per process to warnings, so the server log keeps only real problems.
 */
void quietOcctInfoMessages() {
  for (const Handle(Message_Printer) & printer : Message::DefaultMessenger()->Printers()) {
    printer->SetTraceLevel(Message_Warning);
  }
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

  quietOcctInfoMessages();

  tinycad::app::CoreConfig config;
  config.address = environment("TINYCAD_CORE_ADDRESS", "0.0.0.0:50051");
  config.dataDir = environment("TINYCAD_DATA_DIR", "/data");
  config.idleTimeout = idleTimeout();

  const std::unique_ptr<tinycad::app::CoreServer> server = tinycad::app::CoreServer::start(config);
  if (!server) {
    std::cerr << "tinycad-core: cannot listen on " << config.address << '\n';
    return EXIT_FAILURE;
  }
  std::cout << "tinycad-core listening on " << config.address << ", data in "
            << config.dataDir.string() << std::endl;

  int received = 0;
  sigwait(&signals, &received);
  std::cout << "tinycad-core: signal " << received << ", shutting down" << std::endl;
  server->shutdown();
  return EXIT_SUCCESS;
}
