#pragma once

// Errors of SessionService and DocumentService (spec 14 "Chyby", errors.proto; Q094 principle 4).
//
// Inside the session layer an expected failure is a value, SessionError (decision N10). Only the
// gRPC services of the rpc layer turn it into a google.rpc.Status with one ErrorDetail
// (rpc::toStatus, decision N154). The gRPC code is derived from the reason by the one table of
// errors.proto, so no caller picks a code by hand.
//
// A programmer error (TINYCAD_ASSERT, an exception out of a handler or a builder) is caught by the
// service around the body of each RPC and reported as INTERNAL.

#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/features/sketch_solve.hpp"
#include "tinycad/storage/document_service.hpp"
#include "tinycad/storage/persistent_document.hpp"

namespace tinycad::session {

/**
 * The reasons of errors.proto the session layer produces (the KERNEL_* reasons belong to
 * GeometryService). gRPC code per reason (rpc::toStatus):
 * InvalidOperation, OperationIdReused, InvalidDocument → INVALID_ARGUMENT;
 * UnknownTarget, ReadOnly, TransactionOpen, NoTransaction, NothingToUndo, NothingToRedo,
 * SketchNotSolved, DocumentOpen → FAILED_PRECONDITION;
 * SessionNotFound, DocumentNotFound → NOT_FOUND; Storage → UNAVAILABLE;
 * Internal → INTERNAL with ERROR_REASON_UNSPECIFIED.
 */
enum class ErrorReason {
  InvalidOperation,
  /**
   * Reserved: M41 ChangeErrorCode has no "unknown target" yet, so a handler refusing an unknown
   * feature comes back as InvalidOperation. With one writer per document (Q102) the client can
   * only hit it after a STORAGE reload (N35); see the M45 plan.
   */
  UnknownTarget,
  ReadOnly,
  TransactionOpen,
  NoTransaction,
  NothingToUndo,
  NothingToRedo,
  OperationIdReused,
  SketchNotSolved,
  SessionNotFound,
  DocumentNotFound,
  InvalidDocument,
  /**
   * DeleteDocument, or RenameDocument while the writer has a transaction open, of a document that
   * is open in a session (N56, ERROR_REASON_DOCUMENT_OPEN added to errors.proto by M45).
   */
  DocumentOpen,
  Storage,
  Internal,
};

struct SessionError {
  ErrorReason reason = ErrorReason::Internal;
  /** ErrorDetail.path: the wrong field of the request ('op.feature_set_params.feature_id'). */
  std::string path;
  /** ErrorDetail.issues (InvalidOperation, SketchNotSolved, InvalidDocument). */
  std::vector<document::ParamIssue> issues;
  /** Status.message: technical text for the log; never compared by tests. */
  std::string message;
};

template <class T>
using SessionResult = core::Result<T, SessionError>;

/** ChangeErrorCode → reason 1:1 (InvalidOperation keeps `path`; Storage → Storage). */
SessionError fromChangeError(const storage::ChangeError& error);

/**
 * ServiceErrorCode → reason: NotFound → DocumentNotFound, InvalidDocument → InvalidDocument (the
 * load issues as below), InvalidName → InvalidOperation with path 'name', OperationIdReused,
 * BrokenDocument → InvalidDocument, Storage → Storage.
 */
SessionError fromServiceError(const storage::ServiceError& error);

/**
 * A stored document that does not load (OpenSession): Kind::Storage → Storage, every other kind
 * → InvalidDocument. Each DocumentLoadIssue becomes ParamIssue { param: <path>, code:
 * 'document.loadIssue', params: { message } }; ErrorDetail.path = the first path ('entry' issues
 * are prefixed 'entries[<seq>].'), as the load error screen of the client shows today.
 */
SessionError fromLoadError(const storage::LoadError& error);

/** SketchNotSolved with its issues ({ param: 'sketch', code: 'sketch.notSolved' }). */
SessionError fromSketchNotSolved(const features::SketchNotSolved& error);

}  // namespace tinycad::session
