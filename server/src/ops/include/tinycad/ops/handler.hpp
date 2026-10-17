#pragma once

// The handler of one operation type and their registry (spec 04 "Handler operace",
// src/ops/op-handler.ts and handler.ts). Each built-in type has its own subclass of OpHandler
// (src/handlers/); the registry is filled with them on construction.
//
// Difference to TS: invert and apply return a Result instead of throwing. An operation that does
// not fit the document (an unknown feature, an index out of range, a migration that fails) is an
// expected failure here, because the operations come from clients over the network (M45); the
// document mutators are then never called with arguments they would assert on.

#include <memory>
#include <optional>
#include <string_view>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

class OpHandler {
 public:
  virtual ~OpHandler() = default;

  /** Registry key, "feature.add". */
  [[nodiscard]] virtual std::string_view type() const = 0;
  /** The current version (OP_VERSION). */
  [[nodiscard]] virtual int version() const = 0;

  /**
   * The shape of the payload of an operation of the current version (the envelope is checked
   * already), paths relative to the operation; empty = fine. Run when loading and before every
   * apply (M19.1), so a write never accepts what loading refuses. Shape only, not the relation to
   * the document.
   */
  [[nodiscard]] virtual std::vector<OperationLoadError> validate(const Operation& op) const;

  /**
   * The inverse computed from the CURRENT state – called BEFORE apply, with a validated
   * operation. Fails when the operation does not fit the document (e.g. an unknown feature).
   */
  [[nodiscard]] virtual core::Result<Operation, OperationLoadError> invert(
      const document::DocumentReader& doc, const Operation& op) const = 0;

  /**
   * Applies the change, deterministically (no clock, random numbers or new ids). On failure the
   * document is unchanged.
   */
  virtual core::Result<void, OperationLoadError> apply(document::DocumentWriter& doc,
                                                       const Operation& op) const = 0;

  /** Merges two consecutive operations of this type (two setParams of one feature); nullopt = no. */
  [[nodiscard]] virtual std::optional<Operation> merge(const Operation& prev,
                                                       const Operation& next) const;

  [[nodiscard]] virtual bool hasUpcast() const { return false; }
  /**
   * An older version of the operation → the current one (loading a log). Called only when
   * hasUpcast(), with 1 <= fromVersion < version() and an object; upcastOperation validates the
   * result.
   */
  [[nodiscard]] virtual Operation upcast(int fromVersion, const Operation& raw) const;
};

using OpHandlerPtr = std::shared_ptr<const OpHandler>;

class OpHandlerRegistry {
 public:
  /**
   * A registry with the twelve built-in handlers. feature.add and feature.setParams migrate the
   * feature data they carry with `schemas` when applied (Q035); `schemas` must outlive the
   * registry.
   */
  explicit OpHandlerRegistry(const document::FeatureSchemaRegistryReader& schemas);

  /** Throws AssertionError: "batch" (a structural operation, Q031) or a duplicate type. */
  void add(OpHandlerPtr handler);

  /** nullptr for an unknown type. */
  [[nodiscard]] const OpHandler* find(std::string_view type) const;
  /** An unknown type throws AssertionError. */
  [[nodiscard]] const OpHandler& get(std::string_view type) const;
  /** In registration order. */
  [[nodiscard]] std::vector<const OpHandler*> all() const;

 private:
  std::vector<OpHandlerPtr> handlers_;
};

}  // namespace tinycad::ops
