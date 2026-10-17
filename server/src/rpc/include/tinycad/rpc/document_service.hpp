#pragma once

// The gRPC adapter of tinycad.v1.DocumentService (spec 14 "Přehled", decision N37): a thin layer
// over the catalog methods of SessionManager (which route RenameDocument of an open document to
// its RuntimeDocument and refuse DeleteDocument of an open one, N56). Not to be confused with
// storage::DocumentService (M41), the application service it ends in.
//
// Conversions: DocumentSummary ms → google.protobuf.Timestamp; ImportDocument.content bytes →
// UTF-8 text; ServiceError / SessionError → toStatus (fromServiceError). Idempotent requests
// (CreateDocument, RenameDocument) take operationKey(request) (N57); ImportDocument takes
// storage::importKey(content) like tinycad-import (N107, the same file never duplicates); a missing
// operation_id → InvalidOperation 'operation_id'. Every body in try/catch → INTERNAL.

#include <grpcpp/grpcpp.h>

#include "tinycad/session/session_manager.hpp"
#include "tinycad/v1/session.grpc.pb.h"

namespace tinycad::session {

class DocumentServiceImpl final : public tinycad::v1::DocumentService::Service {
 public:
  /** `manager` must outlive the service. */
  explicit DocumentServiceImpl(SessionManager& manager);

  grpc::Status ListDocuments(grpc::ServerContext* context,
                             const tinycad::v1::ListDocumentsRequest* request,
                             tinycad::v1::ListDocumentsResponse* response) override;
  grpc::Status CreateDocument(grpc::ServerContext* context,
                              const tinycad::v1::CreateDocumentRequest* request,
                              tinycad::v1::CreateDocumentResponse* response) override;
  grpc::Status RenameDocument(grpc::ServerContext* context,
                              const tinycad::v1::RenameDocumentRequest* request,
                              tinycad::v1::RenameDocumentResponse* response) override;
  /** Idempotent: a missing document succeeds; an open one → DOCUMENT_OPEN. */
  grpc::Status DeleteDocument(grpc::ServerContext* context,
                              const tinycad::v1::DeleteDocumentRequest* request,
                              tinycad::v1::DeleteDocumentResponse* response) override;
  grpc::Status ImportDocument(grpc::ServerContext* context,
                              const tinycad::v1::ImportDocumentRequest* request,
                              tinycad::v1::ImportDocumentResponse* response) override;
  grpc::Status ExportDocument(grpc::ServerContext* context,
                              const tinycad::v1::ExportDocumentRequest* request,
                              tinycad::v1::ExportDocumentResponse* response) override;

 private:
  SessionManager& manager_;
};

}  // namespace tinycad::session
