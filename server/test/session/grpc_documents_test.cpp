// DocumentService through a real gRPC channel (spec 14 "Přehled", "Idempotence", "Chyby";
// decisions N37, N56, N107): the list, durable idempotence of create, import and rename, the
// routing of RenameDocument of an open document through its runtime document, DOCUMENT_OPEN, and
// the export that imports back to the same state.

#include <gtest/gtest.h>

#include <fstream>
#include <sstream>
#include <string>

#include "google/rpc/status.pb.h"
#include "session/grpc_harness.hpp"
#include "tinycad/core/json.hpp"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::session {
namespace {

using namespace testing;

/** The one ErrorDetail of a failed status. */
v1::ErrorDetail detailOf(const grpc::Status& status) {
  google::rpc::Status rpc;
  EXPECT_TRUE(rpc.ParseFromString(status.error_details()));
  v1::ErrorDetail detail;
  if (rpc.details_size() > 0) {
    EXPECT_TRUE(rpc.details(0).UnpackTo(&detail));
  }
  return detail;
}

std::string fixture(const std::string& name) {
  std::ifstream in(std::string(TINYCAD_STORAGE_FIXTURES) + "/" + name, std::ios::binary);
  EXPECT_TRUE(in.good()) << name;
  std::ostringstream text;
  text << in.rdbuf();
  return text.str();
}

class GrpcDocumentsTest : public ::testing::Test {
 protected:
  TestServer server;
  std::unique_ptr<v1::DocumentService::Stub> documents = server.documents();

  grpc::Status create(const std::string& name, const std::string& operationId,
                      v1::CreateDocumentResponse* out) {
    grpc::ClientContext context;
    v1::CreateDocumentRequest request;
    request.set_operation_id(operationId);
    request.set_name(name);
    return documents->CreateDocument(&context, request, out);
  }

  v1::DocumentSummary created(const std::string& name, const std::string& operationId) {
    v1::CreateDocumentResponse out;
    const grpc::Status status = create(name, operationId, &out);
    EXPECT_TRUE(status.ok()) << status.error_message();
    return out.document();
  }

  v1::ListDocumentsResponse list() {
    grpc::ClientContext context;
    v1::ListDocumentsResponse out;
    const grpc::Status status = documents->ListDocuments(&context, {}, &out);
    EXPECT_TRUE(status.ok()) << status.error_message();
    return out;
  }

  grpc::Status rename(const std::string& id, const std::string& name,
                      const std::string& operationId, v1::RenameDocumentResponse* out) {
    grpc::ClientContext context;
    v1::RenameDocumentRequest request;
    request.set_operation_id(operationId);
    request.set_document_id(id);
    request.set_name(name);
    return documents->RenameDocument(&context, request, out);
  }

  grpc::Status remove(const std::string& id) {
    grpc::ClientContext context;
    v1::DeleteDocumentRequest request;
    request.set_document_id(id);
    v1::DeleteDocumentResponse out;
    return documents->DeleteDocument(&context, request, &out);
  }

  grpc::Status import(const std::string& content, const std::string& operationId,
                      v1::ImportDocumentResponse* out) {
    grpc::ClientContext context;
    v1::ImportDocumentRequest request;
    request.set_operation_id(operationId);
    request.set_content(content);
    return documents->ImportDocument(&context, request, out);
  }

  grpc::Status exportDocument(const std::string& id, v1::ExportDocumentResponse* out) {
    grpc::ClientContext context;
    v1::ExportDocumentRequest request;
    request.set_document_id(id);
    return documents->ExportDocument(&context, request, out);
  }

  SessionPtr openSession(const std::string& id) {
    auto opened = server.manager().open(document::DocumentId(id), std::nullopt, "");
    EXPECT_TRUE(opened.has_value()) << (opened ? "" : opened.error().message);
    return opened ? opened->session : nullptr;
  }

  static std::string nameInReadModel(const SessionPtr& session) {
    v1::ReadModel model;
    EXPECT_TRUE(session->document().readModel(session->caller(), {}, &model));
    return model.document().name();
  }
};

TEST_F(GrpcDocumentsTest, ListsTheDocumentsMostRecentlyUpdatedFirstWithTimestamps) {
  server.wallTime = 1000;
  const auto older = created("Older", "op-1");
  server.wallTime = 5000;
  const auto newer = created("Newer", "op-2");

  const auto listed = list();
  ASSERT_EQ(listed.documents_size(), 2);
  EXPECT_EQ(listed.documents(0).document_id(), newer.document_id());
  EXPECT_EQ(listed.documents(0).name(), "Newer");
  EXPECT_EQ(listed.documents(1).document_id(), older.document_id());
  EXPECT_EQ(listed.documents(0).updated().seconds(), 5);
  EXPECT_EQ(listed.documents(1).created().seconds(), 1);
}

TEST_F(GrpcDocumentsTest, CreateIsIdempotentByOperationId) {
  const auto first = created("Part", "op-1");
  const auto repeated = created("Part", "op-1");
  EXPECT_EQ(repeated.document_id(), first.document_id());
  EXPECT_EQ(list().documents_size(), 1);

  v1::CreateDocumentResponse out;
  const grpc::Status reused = create("Other", "op-1", &out);
  EXPECT_EQ(reused.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(reused).reason(), v1::ERROR_REASON_OPERATION_ID_REUSED);
}

TEST_F(GrpcDocumentsTest, ARequestWithoutOperationIdIsInvalid) {
  v1::CreateDocumentResponse out;
  const grpc::Status status = create("Part", "", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_INVALID_OPERATION);
  EXPECT_EQ(detailOf(status).path(), "operation_id");
}

TEST_F(GrpcDocumentsTest, AnEmptyNameIsInvalidWithPathName) {
  v1::CreateDocumentResponse out;
  const grpc::Status status = create("   ", "op-1", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(status).path(), "name");
}

TEST_F(GrpcDocumentsTest, RenamesAClosedDocumentIdempotently) {
  const auto part = created("Part", "op-1");
  server.wallTime = 7000;
  v1::RenameDocumentResponse out;
  ASSERT_TRUE(rename(part.document_id(), "Bracket", "op-2", &out).ok());
  EXPECT_EQ(out.document().name(), "Bracket");
  EXPECT_EQ(out.document().updated().seconds(), 7);

  v1::RenameDocumentResponse again;
  ASSERT_TRUE(rename(part.document_id(), "Bracket", "op-2", &again).ok());
  EXPECT_EQ(again.document().name(), "Bracket");
  EXPECT_EQ(list().documents(0).name(), "Bracket");
  EXPECT_FALSE(server.manager().isLoaded(document::DocumentId(part.document_id())));
}

TEST_F(GrpcDocumentsTest, RenamingAMissingDocumentIsDocumentNotFound) {
  v1::RenameDocumentResponse out;
  const grpc::Status status = rename("nope", "X", "op-1", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_DOCUMENT_NOT_FOUND);
}

TEST_F(GrpcDocumentsTest, RenamingAnOpenDocumentGoesThroughItsSession) {
  const auto part = created("Part", "op-1");
  const SessionPtr session = openSession(part.document_id());
  ASSERT_NE(session, nullptr);

  v1::RenameDocumentResponse out;
  const grpc::Status status = rename(part.document_id(), "Bracket", "op-2", &out);
  ASSERT_TRUE(status.ok()) << status.error_message();
  EXPECT_EQ(out.document().name(), "Bracket");
  EXPECT_EQ(nameInReadModel(session), "Bracket");
  const auto changes = changedOf(session->document());
  ASSERT_EQ(changes.size(), 1U);
  EXPECT_EQ(changes[0].by_session_id(), "");
}

TEST_F(GrpcDocumentsTest, RenamingAnOpenDocumentDuringATransactionIsDocumentOpen) {
  const auto part = created("Part", "op-1");
  const SessionPtr session = openSession(part.document_id());
  v1::ChangeResult change;
  ASSERT_TRUE(session->document().begin(session->caller(), "T",
                                        StepKey{session->recent(), key("step-1")}, {}, &change));

  v1::RenameDocumentResponse out;
  const grpc::Status status = rename(part.document_id(), "Bracket", "op-2", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_DOCUMENT_OPEN);
}

TEST_F(GrpcDocumentsTest, DeletingAMissingDocumentSucceeds) {
  EXPECT_TRUE(remove("nope").ok());
  EXPECT_TRUE(remove("").ok());
}

TEST_F(GrpcDocumentsTest, DeletingAnOpenDocumentIsDocumentOpenAClosedOneIsRemoved) {
  const auto part = created("Part", "op-1");
  const SessionPtr session = openSession(part.document_id());
  const grpc::Status refused = remove(part.document_id());
  EXPECT_EQ(refused.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
  EXPECT_EQ(detailOf(refused).reason(), v1::ERROR_REASON_DOCUMENT_OPEN);
  EXPECT_EQ(list().documents_size(), 1);

  server.manager().close(session->id().str());
  EXPECT_TRUE(remove(part.document_id()).ok());
  EXPECT_EQ(list().documents_size(), 0);
}

TEST_F(GrpcDocumentsTest, ImportsFormatOneAndTwoIdempotently) {
  const std::string v1File = fixture("old-part-v1.tinycad.json");
  const std::string v2File = fixture("bracket-history.tinycad.json");

  v1::ImportDocumentResponse old;
  ASSERT_TRUE(import(v1File, "op-1", &old).ok());
  EXPECT_EQ(old.document().name(), "Old part");
  v1::ImportDocumentResponse bracket;
  ASSERT_TRUE(import(v2File, "op-2", &bracket).ok());
  EXPECT_EQ(bracket.document().name(), "Bracket");

  v1::ImportDocumentResponse again;
  ASSERT_TRUE(import(v2File, "op-2", &again).ok());
  EXPECT_EQ(again.document().document_id(), bracket.document().document_id());
  EXPECT_EQ(list().documents_size(), 2);
}

TEST_F(GrpcDocumentsTest, TheImportKeyComesFromTheContentAsInTinycadImport) {
  const std::string file = fixture("bracket-history.tinycad.json");
  v1::ImportDocumentResponse first;
  ASSERT_TRUE(import(file, "op-1", &first).ok());
  v1::ImportDocumentResponse second;
  ASSERT_TRUE(import(file, "op-other", &second).ok());
  EXPECT_EQ(second.document().document_id(), first.document().document_id());
  EXPECT_EQ(list().documents_size(), 1);
}

TEST_F(GrpcDocumentsTest, ABrokenFileIsInvalidDocumentWithIssues) {
  core::Json broken = core::Json::parse(fixture("old-part-v1.tinycad.json"));
  broken["snapshot"]["document"]["studio"]["rollbackIndex"] = "x";
  v1::ImportDocumentResponse out;
  const grpc::Status status = import(broken.dump(), "op-1", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  const v1::ErrorDetail detail = detailOf(status);
  EXPECT_EQ(detail.reason(), v1::ERROR_REASON_INVALID_DOCUMENT);
  EXPECT_GT(detail.issues_size(), 0);
  EXPECT_EQ(list().documents_size(), 0);

  const grpc::Status notJson = import("{", "op-2", &out);
  EXPECT_EQ(detailOf(notJson).reason(), v1::ERROR_REASON_INVALID_DOCUMENT);
}

TEST_F(GrpcDocumentsTest, AnExportImportsBackToTheSameState) {
  v1::ImportDocumentResponse bracket;
  ASSERT_TRUE(import(fixture("bracket-history.tinycad.json"), "op-1", &bracket).ok());

  v1::ExportDocumentResponse exported;
  ASSERT_TRUE(exportDocument(bracket.document().document_id(), &exported).ok());
  EXPECT_EQ(exported.file_name(), "Bracket.tinycad.json");

  ASSERT_TRUE(remove(bracket.document().document_id()).ok());
  v1::ImportDocumentResponse back;
  ASSERT_TRUE(import(exported.content(), "op-2", &back).ok());
  v1::ExportDocumentResponse again;
  ASSERT_TRUE(exportDocument(back.document().document_id(), &again).ok());

  core::Json before = core::Json::parse(exported.content());
  core::Json after = core::Json::parse(again.content());
  // The id is new on every import; everything else is the same document.
  EXPECT_EQ(after["snapshot"]["document"]["studio"], before["snapshot"]["document"]["studio"]);
  EXPECT_EQ(after["snapshot"]["atSeq"], before["snapshot"]["atSeq"]);
  EXPECT_EQ(after["history"]["entries"].size(), before["history"]["entries"].size());
  EXPECT_EQ(back.document().name(), "Bracket");
}

TEST_F(GrpcDocumentsTest, ExportingAMissingDocumentIsDocumentNotFound) {
  v1::ExportDocumentResponse out;
  const grpc::Status status = exportDocument("nope", &out);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_DOCUMENT_NOT_FOUND);
}

TEST_F(GrpcDocumentsTest, DocumentsSurviveARestartOverTheSameDataDirectory) {
  const auto part = created("Part", "op-1");
  server.restart();
  documents = server.documents();
  const auto listed = list();
  ASSERT_EQ(listed.documents_size(), 1);
  EXPECT_EQ(listed.documents(0).document_id(), part.document_id());
  // Durable idempotence holds across the restart.
  EXPECT_EQ(created("Part", "op-1").document_id(), part.document_id());
}

}  // namespace
}  // namespace tinycad::session
