#pragma once

// The gRPC adapter of tinycad.v1.SessionService (spec 14): request → SessionManager /
// RuntimeDocument → response, SessionError → google.rpc.Status (toStatus). No domain logic here;
// every method has the same shape:
//
//   try {
//     find the session (SessionNotFound)            – every RPC but OpenSession and CloseSession
//     convert the request (operationToJson, operationKey / StepKey)
//     call the RuntimeDocument, fill the response
//   } catch (...) { return internalStatusOfCurrentException(); }
//
// A missing operation_id on a changing RPC → InvalidOperation 'operation_id'. Synchronous gRPC
// API (N54): WatchSession blocks its handler thread in EventRing::waitAfter.

#include <grpcpp/grpcpp.h>

#include <vector>

#include "tinycad/session/session_manager.hpp"
#include "tinycad/v1/schema.pb.h"
#include "tinycad/v1/session.grpc.pb.h"

namespace tinycad::session {

class SessionServiceImpl final : public tinycad::v1::SessionService::Service {
 public:
  /**
   * `manager` must outlive the service; `featureTypes` = describeFeatureTypes of the server's
   * schema registry, sent with every OpenSessionResponse (Q098).
   */
  SessionServiceImpl(SessionManager& manager,
                     std::vector<tinycad::v1::FeatureTypeDescriptor> featureTypes);

  /**
   * SessionManager::open (resume_session_id, N56) → session_id, feature_types, the read model of
   * the new session (read options of the request) and event_seq = events().lastSeq() taken
   * under the same document lock as the read model, so WatchSession after it misses nothing.
   */
  grpc::Status OpenSession(grpc::ServerContext* context,
                           const tinycad::v1::OpenSessionRequest* request,
                           tinycad::v1::OpenSessionResponse* response) override;
  /** Idempotent: an unknown or closed session succeeds. */
  grpc::Status CloseSession(grpc::ServerContext* context,
                            const tinycad::v1::CloseSessionRequest* request,
                            tinycad::v1::CloseSessionResponse* response) override;
  grpc::Status GetReadModel(grpc::ServerContext* context,
                            const tinycad::v1::GetReadModelRequest* request,
                            tinycad::v1::GetReadModelResponse* response) override;

  grpc::Status Dispatch(grpc::ServerContext* context, const tinycad::v1::DispatchRequest* request,
                        tinycad::v1::DispatchResponse* response) override;
  grpc::Status BeginTransaction(grpc::ServerContext* context,
                                const tinycad::v1::BeginTransactionRequest* request,
                                tinycad::v1::BeginTransactionResponse* response) override;
  grpc::Status Apply(grpc::ServerContext* context, const tinycad::v1::ApplyRequest* request,
                     tinycad::v1::ApplyResponse* response) override;
  grpc::Status ApplyTransient(grpc::ServerContext* context,
                              const tinycad::v1::ApplyTransientRequest* request,
                              tinycad::v1::ApplyTransientResponse* response) override;
  grpc::Status Commit(grpc::ServerContext* context, const tinycad::v1::CommitRequest* request,
                      tinycad::v1::CommitResponse* response) override;
  grpc::Status Abort(grpc::ServerContext* context, const tinycad::v1::AbortRequest* request,
                     tinycad::v1::AbortResponse* response) override;
  grpc::Status Undo(grpc::ServerContext* context, const tinycad::v1::UndoRequest* request,
                    tinycad::v1::UndoResponse* response) override;
  grpc::Status Redo(grpc::ServerContext* context, const tinycad::v1::RedoRequest* request,
                    tinycad::v1::RedoResponse* response) override;

  grpc::Status GetHistory(grpc::ServerContext* context,
                          const tinycad::v1::GetHistoryRequest* request,
                          tinycad::v1::GetHistoryResponse* response) override;
  grpc::Status ExportStep(grpc::ServerContext* context,
                          const tinycad::v1::ExportStepRequest* request,
                          tinycad::v1::ExportStepResponse* response) override;

  /**
   * SessionManager::watch (the guard keeps the session from the idle timeout), then a loop until
   * the client cancels or the document is unloaded (EventRing closed → OK, the client reconnects
   * and gets SESSION_NOT_FOUND): EventRing::after(after_seq) – nullopt → write `resync` (seq =
   * lastSeq) and continue from lastSeq; otherwise write every event and advance; then waitAfter
   * with the deadline now + heartbeat; nothing new → write `heartbeat` (seq = the last sent seq,
   * heartbeats do not consume a seq). A failed Write ends the stream.
   */
  grpc::Status WatchSession(grpc::ServerContext* context,
                            const tinycad::v1::WatchSessionRequest* request,
                            grpc::ServerWriter<tinycad::v1::WatchSessionResponse>* writer) override;

 private:
  SessionManager& manager_;
  std::vector<tinycad::v1::FeatureTypeDescriptor> featureTypes_;
};

}  // namespace tinycad::session
