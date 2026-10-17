// Stub of M45 task 1; implemented by task 5.
#include "tinycad/session/document_service.hpp"

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

grpc::Status unimplemented() { return {grpc::StatusCode::UNIMPLEMENTED, "not implemented"}; }

}  // namespace

DocumentServiceImpl::DocumentServiceImpl(SessionManager& manager) : manager_(manager) {}

grpc::Status DocumentServiceImpl::ListDocuments(grpc::ServerContext* /*context*/,
                                                const v1::ListDocumentsRequest* /*request*/,
                                                v1::ListDocumentsResponse* /*response*/) {
  return unimplemented();
}

grpc::Status DocumentServiceImpl::CreateDocument(grpc::ServerContext* /*context*/,
                                                 const v1::CreateDocumentRequest* /*request*/,
                                                 v1::CreateDocumentResponse* /*response*/) {
  return unimplemented();
}

grpc::Status DocumentServiceImpl::RenameDocument(grpc::ServerContext* /*context*/,
                                                 const v1::RenameDocumentRequest* /*request*/,
                                                 v1::RenameDocumentResponse* /*response*/) {
  return unimplemented();
}

grpc::Status DocumentServiceImpl::DeleteDocument(grpc::ServerContext* /*context*/,
                                                 const v1::DeleteDocumentRequest* /*request*/,
                                                 v1::DeleteDocumentResponse* /*response*/) {
  return unimplemented();
}

grpc::Status DocumentServiceImpl::ImportDocument(grpc::ServerContext* /*context*/,
                                                 const v1::ImportDocumentRequest* /*request*/,
                                                 v1::ImportDocumentResponse* /*response*/) {
  return unimplemented();
}

grpc::Status DocumentServiceImpl::ExportDocument(grpc::ServerContext* /*context*/,
                                                 const v1::ExportDocumentRequest* /*request*/,
                                                 v1::ExportDocumentResponse* /*response*/) {
  return unimplemented();
}

}  // namespace tinycad::session
