#pragma once

// Two role interfaces (spec 03 "Čtení a zápis: dvě rozhraní", ADR 0011, src/document/document.ts):
// everyone reads, only op handlers (server/src/ops) write. The session hands the DocumentWriter
// out as a `const DocumentReader&`.
//
// No events (decision N21): the server has no document subscribers; whoever changes the document
// (the dispatcher, M40) tells the next layer itself. The TS machinery for subscriber exceptions
// (deferred errors, AggregateError) therefore has no C++ counterpart.

#include <memory>
#include <string>

#include "tinycad/document/model.hpp"

namespace tinycad::document {

class DocumentReader {
 public:
  virtual ~DocumentReader() = default;

  [[nodiscard]] virtual const DocumentMeta& meta() const = 0;
  /**
   * The current snapshot. Every actual change replaces it with a new StudioPtr (untouched
   * features shared); a call that changes nothing keeps the same pointer, so `studio() == before`
   * means "unchanged" (applyOperation relies on it, spec 04).
   */
  [[nodiscard]] virtual StudioPtr studio() const = 0;
  /** nullptr when the feature does not exist. */
  [[nodiscard]] virtual FeaturePtr feature(const FeatureId& id) const = 0;
  /** -1 when the feature does not exist. */
  [[nodiscard]] virtual int indexOf(const FeatureId& id) const = 0;
  /** An empty BodyMeta for a body without metadata. */
  [[nodiscard]] virtual BodyMeta bodyMeta(const BodyId& body) const = 0;
};

/**
 * Mutators guard the document invariants and throw core::AssertionError on violation (programmer
 * error), with the document unchanged. They do not validate feature params: invalid params are a
 * legitimate document state. Rollback bar rules as in TS (spec 03, Q029).
 */
class DocumentWriter : public DocumentReader {
 public:
  virtual void insertFeature(int index, FeaturePtr feature) = 0;
  virtual void removeFeature(const FeatureId& id) = 0;
  /** Same id, new data. */
  virtual void replaceFeature(FeaturePtr feature) = 0;
  virtual void moveFeature(const FeatureId& id, int toIndex) = 0;
  virtual void setRollbackIndex(int index) = 0;
  /**
   * Stores the metadata in canonical form (empty removes the entry); the body need not exist.
   * Same metadata by value = no change (studio pointer kept).
   */
  virtual void setBodyMeta(const BodyId& body, const BodyMeta& meta) = 0;
  virtual void rename(std::string name) = 0;
};

/**
 * The in-memory document (createDocument / CadDocument in TS): the one implementation of both
 * roles. Holds the meta and the current StudioPtr; every mutator builds a new PartStudioData that
 * shares the untouched features. Not thread-safe (the session serializes changes, spec 14).
 */
class Document final : public DocumentWriter {
 public:
  /**
   * Checks the invariants of the studio (unique valid feature ids, rollback index in range,
   * canonical body metadata) and throws AssertionError when they do not hold; data from outside
   * goes through fromData (serialize.hpp) instead.
   */
  Document(DocumentMeta meta, StudioPtr studio);

  [[nodiscard]] const DocumentMeta& meta() const override;
  [[nodiscard]] StudioPtr studio() const override;
  [[nodiscard]] FeaturePtr feature(const FeatureId& id) const override;
  [[nodiscard]] int indexOf(const FeatureId& id) const override;
  [[nodiscard]] BodyMeta bodyMeta(const BodyId& body) const override;

  void insertFeature(int index, FeaturePtr feature) override;
  void removeFeature(const FeatureId& id) override;
  void replaceFeature(FeaturePtr feature) override;
  void moveFeature(const FeatureId& id, int toIndex) override;
  void setRollbackIndex(int index) override;
  void setBodyMeta(const BodyId& body, const BodyMeta& meta) override;
  void rename(std::string name) override;

 private:
  DocumentMeta meta_;
  StudioPtr studio_;
};

}  // namespace tinycad::document
