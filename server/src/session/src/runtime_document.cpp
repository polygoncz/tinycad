// Stub of M45 task 1; implemented by task 3.
#include "tinycad/session/runtime_document.hpp"

#include <utility>

#include "not_implemented.hpp"

namespace tinycad::session {

struct RuntimeDocument::Impl {};

RuntimeDocument::RuntimeDocument(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

RuntimeDocument::~RuntimeDocument() = default;

SessionResult<std::unique_ptr<RuntimeDocument>> RuntimeDocument::open(
    const document::DocumentId& /*id*/, const Dependencies& /*deps*/) {
  return core::fail(notImplemented("RuntimeDocument::open"));
}

const document::DocumentId& RuntimeDocument::id() const {
  throwNotImplemented("RuntimeDocument::id");
}

bool RuntimeDocument::acquireLease(const SessionId& /*session*/) {
  throwNotImplemented("RuntimeDocument::acquireLease");
}

void RuntimeDocument::releaseLease(const SessionId& /*session*/) {
  throwNotImplemented("RuntimeDocument::releaseLease");
}

std::optional<SessionId> RuntimeDocument::leaseHolder() const {
  throwNotImplemented("RuntimeDocument::leaseHolder");
}

SessionResult<void> RuntimeDocument::dispatch(const Caller& /*caller*/, const core::Json& /*op*/,
                                              const std::string& /*label*/,
                                              const storage::OperationKey& /*key*/,
                                              const tinycad::v1::ReadModelOptions& /*options*/,
                                              tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::dispatch"));
}

SessionResult<void> RuntimeDocument::begin(const Caller& /*caller*/, const std::string& /*label*/,
                                           const StepKey& /*step*/,
                                           const tinycad::v1::ReadModelOptions& /*options*/,
                                           tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::begin"));
}

SessionResult<void> RuntimeDocument::apply(const Caller& /*caller*/, const core::Json& /*op*/,
                                           const StepKey& /*step*/,
                                           const tinycad::v1::ReadModelOptions& /*options*/,
                                           tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::apply"));
}

SessionResult<void> RuntimeDocument::applyTransient(
    const Caller& /*caller*/, const core::Json& /*op*/, const StepKey& /*step*/,
    const tinycad::v1::ReadModelOptions& /*options*/, tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::applyTransient"));
}

SessionResult<void> RuntimeDocument::commit(const Caller& /*caller*/,
                                            const storage::OperationKey& /*key*/,
                                            const tinycad::v1::ReadModelOptions& /*options*/,
                                            tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::commit"));
}

SessionResult<void> RuntimeDocument::abort(const Caller& /*caller*/, const StepKey& /*step*/,
                                           const tinycad::v1::ReadModelOptions& /*options*/,
                                           tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::abort"));
}

SessionResult<void> RuntimeDocument::undo(const Caller& /*caller*/,
                                          const storage::OperationKey& /*key*/,
                                          const tinycad::v1::ReadModelOptions& /*options*/,
                                          tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::undo"));
}

SessionResult<void> RuntimeDocument::redo(const Caller& /*caller*/,
                                          const storage::OperationKey& /*key*/,
                                          const tinycad::v1::ReadModelOptions& /*options*/,
                                          tinycad::v1::ChangeResult* /*out*/) {
  return core::fail(notImplemented("RuntimeDocument::redo"));
}

SessionResult<storage::DocumentSummary> RuntimeDocument::rename(
    const std::string& /*name*/, const storage::OperationKey& /*key*/) {
  return core::fail(notImplemented("RuntimeDocument::rename"));
}

SessionResult<void> RuntimeDocument::readModel(const Caller& /*caller*/,
                                               const tinycad::v1::ReadModelOptions& /*options*/,
                                               tinycad::v1::ReadModel* /*out*/,
                                               std::uint64_t* /*eventSeq*/) {
  return core::fail(notImplemented("RuntimeDocument::readModel"));
}

void RuntimeDocument::history(std::int64_t /*fromSeq*/, tinycad::v1::GetHistoryResponse* /*out*/) {
  throwNotImplemented("RuntimeDocument::history");
}

SessionResult<StepFile> RuntimeDocument::exportStep() {
  return core::fail(notImplemented("RuntimeDocument::exportStep"));
}

EventRing& RuntimeDocument::events() { throwNotImplemented("RuntimeDocument::events"); }

}  // namespace tinycad::session
