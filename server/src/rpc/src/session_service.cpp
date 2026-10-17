#include "tinycad/rpc/session_service.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>

#include "tinycad/rpc/feature_types.hpp"
#include "tinycad/rpc/fingerprint.hpp"
#include "tinycad/rpc/operation_codec.hpp"
#include "tinycad/rpc/read_model_proto.hpp"
#include "tinycad/rpc/status.hpp"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using session::ChangeResult;
using session::ErrorReason;
using session::EventRing;
using session::SessionError;
using session::SessionEvent;
using session::SessionPtr;
using session::SessionResult;
using session::StepKey;

namespace {

/**
 * The body of every RPC: a programmer error (an exception out of a handler, a builder or an
 * assert) becomes INTERNAL instead of tearing down the gRPC thread.
 */
template <class Body>
grpc::Status guarded(Body body) {
  try {
    return body();
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

/**
 * The answer to a change: converted into `out` after RuntimeDocument returned, so outside the
 * document lock (N154).
 */
grpc::Status answer(const SessionResult<ChangeResult>& result, v1::ChangeResult* out) {
  if (!result) return toStatus(result.error());
  changeResultToProto(*result, out);
  return grpc::Status::OK;
}

/** The idempotence key of a changing request; a missing operation_id is the client's bug. */
SessionResult<storage::OperationKey> keyOf(const google::protobuf::Message& request,
                                           const std::string& operationId) {
  if (operationId.empty()) {
    return core::fail(
        SessionError{ErrorReason::InvalidOperation, "operation_id", {}, "missing operation_id"});
  }
  return operationKey(request);
}

std::optional<kernel::MeshQuality> qualityOf(const v1::OpenSessionRequest& request) {
  if (!request.has_mesh_quality()) return std::nullopt;
  return kernel::MeshQuality{request.mesh_quality().linear_deflection(),
                             request.mesh_quality().angular_deflection()};
}

/** How often a waiting WatchSession looks whether the client cancelled it. */
constexpr std::chrono::milliseconds kCancelPoll{200};

}  // namespace

SessionServiceImpl::SessionServiceImpl(session::SessionManager& manager,
                                       const document::FeatureSchemaRegistryReader& schemas)
    : manager_(manager), featureTypes_(describeFeatureTypes(schemas)) {}

// --- sessions -------------------------------------------------------------------------------

grpc::Status SessionServiceImpl::OpenSession(grpc::ServerContext* /*context*/,
                                             const v1::OpenSessionRequest* request,
                                             v1::OpenSessionResponse* response) {
  return guarded([&] {
    auto opened = manager_.open(document::DocumentId(request->document_id()), qualityOf(*request),
                                request->resume_session_id());
    if (!opened) return toStatus(opened.error());
    const SessionPtr& session = opened->session;

    std::uint64_t eventSeq = 0;
    auto read = session->document().readModel(session->caller(),
                                              readModelOptionsOf(request->read()), &eventSeq);
    if (!read) {
      // A new session nobody will ever use must not keep the lease (a resumed one stays).
      if (!opened->resumed) manager_.close(session->id().str());
      return toStatus(read.error());
    }
    readModelToProto(*read, response->mutable_read_model());
    response->set_session_id(session->id().str());
    response->set_event_seq(eventSeq);
    for (const v1::FeatureTypeDescriptor& type : featureTypes_) {
      *response->add_feature_types() = type;
    }
    return grpc::Status::OK;
  });
}

grpc::Status SessionServiceImpl::CloseSession(grpc::ServerContext* /*context*/,
                                              const v1::CloseSessionRequest* request,
                                              v1::CloseSessionResponse* /*response*/) {
  return guarded([&] {
    manager_.close(request->session_id());
    return grpc::Status::OK;
  });
}

grpc::Status SessionServiceImpl::GetReadModel(grpc::ServerContext* /*context*/,
                                              const v1::GetReadModelRequest* request,
                                              v1::GetReadModelResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto read =
        (*session)->document().readModel((*session)->caller(), readModelOptionsOf(request->read()));
    if (!read) return toStatus(read.error());
    readModelToProto(*read, response->mutable_read_model());
    return grpc::Status::OK;
  });
}

// --- durable changes ------------------------------------------------------------------------

grpc::Status SessionServiceImpl::Dispatch(grpc::ServerContext* /*context*/,
                                          const v1::DispatchRequest* request,
                                          v1::DispatchResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    auto op = operationToJson(request->op());
    if (!op) return toStatus(op.error());
    return answer((*session)->document().dispatch((*session)->caller(), *op, request->label(),
                                                  *key, readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::Commit(grpc::ServerContext* /*context*/,
                                        const v1::CommitRequest* request,
                                        v1::CommitResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    // StepKey: an empty commit is remembered by the session (N107, N119).
    const StepKey step{(*session)->recent(), *key};
    return answer((*session)->document().commit((*session)->caller(), step,
                                                readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::Undo(grpc::ServerContext* /*context*/,
                                      const v1::UndoRequest* request,
                                      v1::UndoResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    return answer((*session)->document().undo((*session)->caller(), *key,
                                              readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::Redo(grpc::ServerContext* /*context*/,
                                      const v1::RedoRequest* request,
                                      v1::RedoResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    return answer((*session)->document().redo((*session)->caller(), *key,
                                              readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

// --- transaction steps (in-memory idempotence, N58) -----------------------------------------

grpc::Status SessionServiceImpl::BeginTransaction(grpc::ServerContext* /*context*/,
                                                  const v1::BeginTransactionRequest* request,
                                                  v1::BeginTransactionResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    const StepKey step{(*session)->recent(), *key};
    return answer((*session)->document().begin((*session)->caller(), request->label(), step,
                                               readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::Apply(grpc::ServerContext* /*context*/,
                                       const v1::ApplyRequest* request,
                                       v1::ApplyResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    auto op = operationToJson(request->op());
    if (!op) return toStatus(op.error());
    const StepKey step{(*session)->recent(), *key};
    return answer((*session)->document().apply((*session)->caller(), *op, step,
                                               readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::ApplyTransient(grpc::ServerContext* /*context*/,
                                                const v1::ApplyTransientRequest* request,
                                                v1::ApplyTransientResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    auto op = operationToJson(request->op());
    if (!op) return toStatus(op.error());
    const StepKey step{(*session)->recent(), *key};
    return answer((*session)->document().applyTransient((*session)->caller(), *op, step,
                                                        readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

grpc::Status SessionServiceImpl::Abort(grpc::ServerContext* /*context*/,
                                       const v1::AbortRequest* request,
                                       v1::AbortResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto key = keyOf(*request, request->operation_id());
    if (!key) return toStatus(key.error());
    const StepKey step{(*session)->recent(), *key};
    return answer((*session)->document().abort((*session)->caller(), step,
                                               readModelOptionsOf(request->read())),
                  response->mutable_result());
  });
}

// --- reading --------------------------------------------------------------------------------

grpc::Status SessionServiceImpl::GetHistory(grpc::ServerContext* /*context*/,
                                            const v1::GetHistoryRequest* request,
                                            v1::GetHistoryResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    // uint64 on the wire; anything beyond int64 asks for entries that do not exist.
    const std::uint64_t from =
        std::min<std::uint64_t>(request->from_seq(), static_cast<std::uint64_t>(INT64_MAX));
    historyToProto((*session)->document().history(static_cast<std::int64_t>(from)), response);
    return grpc::Status::OK;
  });
}

grpc::Status SessionServiceImpl::ExportStep(grpc::ServerContext* /*context*/,
                                            const v1::ExportStepRequest* request,
                                            v1::ExportStepResponse* response) {
  return guarded([&] {
    auto session = manager_.find(request->session_id());
    if (!session) return toStatus(session.error());
    auto file = (*session)->document().exportStep();
    if (!file) return toStatus(file.error());
    response->set_content(std::move(file->content));
    response->set_file_name(std::move(file->fileName));
    return grpc::Status::OK;
  });
}

// --- events ---------------------------------------------------------------------------------

grpc::Status SessionServiceImpl::WatchSession(
    grpc::ServerContext* context, const v1::WatchSessionRequest* request,
    grpc::ServerWriter<v1::WatchSessionResponse>* writer) {
  return guarded([&] {
    auto guard = manager_.watch(request->session_id());
    if (!guard) return toStatus(guard.error());
    // The session (and so its runtime document) lives as long as the guard.
    EventRing& events = guard->session()->document().events();
    const auto heartbeat = manager_.config().heartbeat;
    using Clock = std::chrono::steady_clock;

    std::uint64_t afterSeq = request->after_seq();
    Clock::time_point lastWrite = Clock::now();
    const auto send = [&](const v1::SessionEvent& event) {
      v1::WatchSessionResponse response;
      *response.mutable_event() = event;
      lastWrite = Clock::now();
      return writer->Write(response);
    };

    while (!context->IsCancelled()) {
      auto pending = events.after(afterSeq);
      if (!pending) {
        // Too old (evicted) or from another instance: the client fetches a new read model.
        v1::SessionEvent resync;
        afterSeq = events.lastSeq();
        resync.set_seq(afterSeq);
        resync.mutable_resync();
        if (!send(resync)) return grpc::Status::OK;
        continue;
      }
      for (const SessionEvent& stored : *pending) {
        afterSeq = stored.seq;
        v1::SessionEvent event;
        sessionEventToProto(stored, &event);
        if (!send(event)) return grpc::Status::OK;
      }
      // The document was unloaded: the stream ends, the client reconnects (SESSION_NOT_FOUND).
      if (events.closed()) return grpc::Status::OK;

      const Clock::time_point heartbeatDue = lastWrite + heartbeat;
      const Clock::time_point deadline = std::min(heartbeatDue, Clock::now() + kCancelPoll);
      auto waited = events.waitAfter(afterSeq, deadline);
      if (waited && waited->empty() && !events.closed() && Clock::now() >= heartbeatDue) {
        // A heartbeat carries the seq of the last event and consumes none.
        v1::SessionEvent beat;
        beat.set_seq(afterSeq);
        beat.mutable_heartbeat();
        if (!send(beat)) return grpc::Status::OK;
      }
    }
    return grpc::Status::OK;
  });
}

}  // namespace tinycad::rpc
