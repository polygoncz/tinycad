// Stub of M45 task 1; implemented by task 4.
#include "tinycad/session/session_service.hpp"

#include <utility>

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

grpc::Status unimplemented() { return {grpc::StatusCode::UNIMPLEMENTED, "not implemented"}; }

}  // namespace

SessionServiceImpl::SessionServiceImpl(SessionManager& manager,
                                       std::vector<v1::FeatureTypeDescriptor> featureTypes)
    : manager_(manager), featureTypes_(std::move(featureTypes)) {}

grpc::Status SessionServiceImpl::OpenSession(grpc::ServerContext* /*context*/,
                                             const v1::OpenSessionRequest* /*request*/,
                                             v1::OpenSessionResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::CloseSession(grpc::ServerContext* /*context*/,
                                              const v1::CloseSessionRequest* /*request*/,
                                              v1::CloseSessionResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::GetReadModel(grpc::ServerContext* /*context*/,
                                              const v1::GetReadModelRequest* /*request*/,
                                              v1::GetReadModelResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Dispatch(grpc::ServerContext* /*context*/,
                                          const v1::DispatchRequest* /*request*/,
                                          v1::DispatchResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::BeginTransaction(grpc::ServerContext* /*context*/,
                                                  const v1::BeginTransactionRequest* /*request*/,
                                                  v1::BeginTransactionResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Apply(grpc::ServerContext* /*context*/,
                                       const v1::ApplyRequest* /*request*/,
                                       v1::ApplyResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::ApplyTransient(grpc::ServerContext* /*context*/,
                                                const v1::ApplyTransientRequest* /*request*/,
                                                v1::ApplyTransientResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Commit(grpc::ServerContext* /*context*/,
                                        const v1::CommitRequest* /*request*/,
                                        v1::CommitResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Abort(grpc::ServerContext* /*context*/,
                                       const v1::AbortRequest* /*request*/,
                                       v1::AbortResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Undo(grpc::ServerContext* /*context*/,
                                      const v1::UndoRequest* /*request*/,
                                      v1::UndoResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::Redo(grpc::ServerContext* /*context*/,
                                      const v1::RedoRequest* /*request*/,
                                      v1::RedoResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::GetHistory(grpc::ServerContext* /*context*/,
                                            const v1::GetHistoryRequest* /*request*/,
                                            v1::GetHistoryResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::ExportStep(grpc::ServerContext* /*context*/,
                                            const v1::ExportStepRequest* /*request*/,
                                            v1::ExportStepResponse* /*response*/) {
  return unimplemented();
}

grpc::Status SessionServiceImpl::WatchSession(
    grpc::ServerContext* /*context*/, const v1::WatchSessionRequest* /*request*/,
    grpc::ServerWriter<v1::WatchSessionResponse>* /*writer*/) {
  return unimplemented();
}

}  // namespace tinycad::session
