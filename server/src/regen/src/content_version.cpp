// content_version of a body (spec 14 "Read model a sítě", Q100, decision N43).

#include "tinycad/regen/content_version.hpp"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::regen {

namespace {

/** Wall-clock ms of the first use in this process: tells a restarted server apart. */
std::int64_t processStartMs() {
  static const std::int64_t start =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count();
  return start;
}

std::atomic<std::uint64_t> instanceCounter{0};

}  // namespace

ContentVersions::ContentVersions()
    : prefix_(std::to_string(processStartMs()) + "-" + std::to_string(++instanceCounter)) {}

ContentVersions::ContentVersions(std::string prefix) : prefix_(std::move(prefix)) {
  TINYCAD_ASSERT(!prefix_.empty() && prefix_.find('.') == std::string::npos,
                 "ContentVersions: the prefix must be non-empty and without '.'");
}

std::string ContentVersions::of(kernel::ShapeHandle shape) const {
  return prefix_ + "." + std::to_string(static_cast<std::uint64_t>(shape));
}

}  // namespace tinycad::regen
