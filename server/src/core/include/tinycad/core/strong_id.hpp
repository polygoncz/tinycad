#pragma once

// A string id that cannot be mixed up with another kind of id: the C++ mirror of Brand<string, …>
// in src/core/brand.ts (decision N16). Construction is explicit, so the one trusted place that
// mints an id (bodyId(), fromData after the shape check, …) stays visible, like the casts in TS.

#include <compare>
#include <functional>
#include <string>
#include <string_view>
#include <utility>

namespace tinycad::core {

template <class Tag>
class StrongId {
 public:
  StrongId() = default;
  explicit StrongId(std::string value) : value_(std::move(value)) {}

  [[nodiscard]] const std::string& str() const noexcept { return value_; }
  [[nodiscard]] bool empty() const noexcept { return value_.empty(); }

  friend bool operator==(const StrongId&, const StrongId&) = default;
  /** Ordered like the TS string comparison of the shared cases (UTF-8 bytes; ids are ASCII). */
  friend auto operator<=>(const StrongId&, const StrongId&) = default;

 private:
  std::string value_;
};

}  // namespace tinycad::core

template <class Tag>
struct std::hash<tinycad::core::StrongId<Tag>> {
  std::size_t operator()(const tinycad::core::StrongId<Tag>& id) const noexcept {
    return std::hash<std::string>{}(id.str());
  }
};
