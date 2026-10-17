// The gRPC adapter of tinycad.v1.DocumentService (spec 14 "Přehled", decision N37). Each RPC has
// the same shape: check the wire fields, call the catalog methods of the SessionManager, fill the
// response; an expected failure becomes toStatus, a programmer error INTERNAL.

#include "tinycad/session/document_service.hpp"

#include <google/protobuf/util/time_util.h>

#include <cmath>
#include <cstdint>
#include <string>

#include "tinycad/session/fingerprint.hpp"
#include "tinycad/session/session_error.hpp"

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

/** ms since the epoch (DocumentSummary) → google.protobuf.Timestamp. */
void setTimestamp(double ms, google::protobuf::Timestamp* out) {
  *out = google::protobuf::util::TimeUtil::MillisecondsToTimestamp(
      static_cast<std::int64_t>(std::llround(ms)));
}

void summaryToProto(const storage::DocumentSummary& summary, v1::DocumentSummary* out) {
  out->set_document_id(summary.id.str());
  out->set_name(summary.name);
  setTimestamp(summary.createdAt, out->mutable_created());
  setTimestamp(summary.updatedAt, out->mutable_updated());
}

/** A changing request without operation_id is a broken client (InvalidOperation 'operation_id'). */
grpc::Status missingOperationId() {
  return toStatus({ErrorReason::InvalidOperation, "operation_id", {}, "operation_id is missing"});
}

grpc::Status serviceFailure(const storage::ServiceError& error) {
  return toStatus(fromServiceError(error));
}

}  // namespace

DocumentServiceImpl::DocumentServiceImpl(SessionManager& manager) : manager_(manager) {}

grpc::Status DocumentServiceImpl::ListDocuments(grpc::ServerContext* /*context*/,
                                                const v1::ListDocumentsRequest* /*request*/,
                                                v1::ListDocumentsResponse* response) {
  try {
    auto listed = manager_.listDocuments();
    if (!listed) return serviceFailure(listed.error());
    for (const storage::DocumentSummary& summary : *listed) {
      summaryToProto(summary, response->add_documents());
    }
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

grpc::Status DocumentServiceImpl::CreateDocument(grpc::ServerContext* /*context*/,
                                                 const v1::CreateDocumentRequest* request,
                                                 v1::CreateDocumentResponse* response) {
  try {
    if (request->operation_id().empty()) return missingOperationId();
    auto created = manager_.createDocument(request->name(), operationKey(*request));
    if (!created) return serviceFailure(created.error());
    summaryToProto(*created, response->mutable_document());
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

grpc::Status DocumentServiceImpl::RenameDocument(grpc::ServerContext* /*context*/,
                                                 const v1::RenameDocumentRequest* request,
                                                 v1::RenameDocumentResponse* response) {
  try {
    if (request->operation_id().empty()) return missingOperationId();
    auto renamed = manager_.renameDocument(document::DocumentId(request->document_id()),
                                           request->name(), operationKey(*request));
    if (!renamed) return toStatus(renamed.error());
    summaryToProto(*renamed, response->mutable_document());
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

grpc::Status DocumentServiceImpl::DeleteDocument(grpc::ServerContext* /*context*/,
                                                 const v1::DeleteDocumentRequest* request,
                                                 v1::DeleteDocumentResponse* /*response*/) {
  try {
    auto removed = manager_.removeDocument(document::DocumentId(request->document_id()));
    if (!removed) return toStatus(removed.error());
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

grpc::Status DocumentServiceImpl::ImportDocument(grpc::ServerContext* /*context*/,
                                                 const v1::ImportDocumentRequest* request,
                                                 v1::ImportDocumentResponse* response) {
  try {
    if (request->operation_id().empty()) return missingOperationId();
    // The key comes from the content, not from the request (spec 14 "Vlákna a zámky serveru",
    // N107): ImportDocument and tinycad-import share importKey, so the same file imported either
    // way finds the document created the first time.
    const std::string& content = request->content();
    auto imported = manager_.importDocument(content, storage::importKey(content));
    if (!imported) return serviceFailure(imported.error());
    summaryToProto(*imported, response->mutable_document());
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

grpc::Status DocumentServiceImpl::ExportDocument(grpc::ServerContext* /*context*/,
                                                 const v1::ExportDocumentRequest* request,
                                                 v1::ExportDocumentResponse* response) {
  try {
    auto exported = manager_.exportDocument(document::DocumentId(request->document_id()));
    if (!exported) return serviceFailure(exported.error());
    response->set_content(exported->content);
    response->set_file_name(exported->fileName);
    return grpc::Status::OK;
  } catch (...) {
    return internalStatusOfCurrentException();
  }
}

}  // namespace tinycad::session
