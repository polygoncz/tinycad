#pragma once

// content_version of a body (spec 14 "Read model a sítě", Q100, decision N43): the key of the mesh
// cache of the client. It must change whenever a builder gives a body a new shape and be unique
// across server restarts and across documents open at the same time.
//
// KISS: a ShapeHandle is never reused within one kernel instance (N14) and every new shape of a
// body is a new handle, so the version is "<prefix>.<handle>". The prefix is unique per
// ContentVersions instance (one per Regenerator, i.e. per runtime document and kernel):
// "<process start in ms>-<instance counter>". A body that passes through a feature unchanged, or
// comes from the cache, keeps its handle and therefore its version; a rebuilt body gets a new
// version even with the same geometry (as the ShapeHandle identity in SceneSync today).

#include <string>

#include "tinycad/kernel/types.hpp"

namespace tinycad::regen {

class ContentVersions {
 public:
  /** A fresh prefix: the process start time in ms and a process-wide atomic counter. */
  ContentVersions();
  /** A fixed prefix, for tests. Not empty and without '.' (AssertionError). */
  explicit ContentVersions(std::string prefix);

  /** "<prefix>.<handle as decimal>". Opaque for clients: they only compare it. */
  [[nodiscard]] std::string of(kernel::ShapeHandle shape) const;
  [[nodiscard]] const std::string& prefix() const { return prefix_; }

 private:
  std::string prefix_;
};

}  // namespace tinycad::regen
